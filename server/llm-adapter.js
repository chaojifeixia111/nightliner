// server/llm-adapter.js
// 多 provider 路由:按 model 名前缀分发到对应后端
//   claude-*    → claude CLI 子进程(走 Anthropic 订阅)
//   deepseek-*  → HTTP 调 DeepSeek API(OpenAI 兼容)
//   qwen-*      → HTTP 调阿里 DashScope(OpenAI 兼容,预留)
import { spawn } from 'child_process';
import { logLlmCall } from './llm-logger.js';

export async function callLlm({ prompt, system, messages, model, trigger, jsonMode = false }) {
  const t0 = Date.now();
  let response = '';
  let error = null;

  // Multi-turn path: 优先 messages,fallback 到 single prompt
  const useMessages = Array.isArray(messages) && messages.length > 0;

  try {
    if (model.startsWith('claude-')) {
      response = useMessages
        ? await callClaudeCliMessages(system, messages, model)
        : await callClaudeCli(prompt, model);
    } else if (model.startsWith('deepseek-')) {
      response = useMessages
        ? await callDeepSeekMessages(system, messages, model, jsonMode)
        : await callDeepSeek(prompt, model, jsonMode);
    } else if (model.startsWith('qwen-')) {
      response = useMessages
        ? await callQwenMessages(system, messages, model, jsonMode)
        : await callQwen(prompt, model, jsonMode);
    } else {
      throw new Error(`Unknown model provider for: ${model}`);
    }
  } catch (e) {
    error = String(e);
    throw e;
  } finally {
    await logLlmCall({
      model, trigger,
      prompt: useMessages ? JSON.stringify({ system, messages }) : prompt,
      response,
      duration_ms: Date.now() - t0,
      error,
    });
  }

  return response;
}

// 兼容旧 import:callClaude({prompt, model, trigger}) 仍可工作
export const callClaude = callLlm;

async function callClaudeCli(prompt, model) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', '--model', model], {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true,
    });
    let stdout = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`claude exited ${code}`));
      try {
        const wrapper = JSON.parse(stdout);
        resolve(wrapper.result || wrapper.message || stdout);
      } catch (e) {
        reject(new Error(`claude output not JSON: ${e.message}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function callDeepSeek(prompt, model, jsonMode) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set (check .env + npm script uses --env-file)');

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 8192,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '<no body>');
    throw new Error(`DeepSeek ${r.status}: ${text}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callQwen(prompt, model, jsonMode) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '<no body>');
    throw new Error(`Qwen ${r.status}: ${text}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

// Multi-turn helpers (messages[] path)

async function callDeepSeekMessages(system, messages, model, jsonMode) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages);

  const body = {
    model,
    messages: msgs,
    temperature: 0.7,
    max_tokens: 8192,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '<no body>');
    throw new Error(`DeepSeek ${r.status}: ${text}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callQwenMessages(system, messages, model, jsonMode) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages);

  const body = { model, messages: msgs, temperature: 0.7 };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Qwen ${r.status}: ${await r.text().catch(() => '<no body>')}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

// claude CLI 不原生支持 messages,把它拼回 single prompt 后用现有路径
async function callClaudeCliMessages(system, messages, model) {
  let text = system ? system + '\n\n---\n\n' : '';
  for (const m of messages) {
    text += `[${m.role}]\n${m.content}\n\n`;
  }
  return callClaudeCli(text, model);
}

// 从 LLM 输出文本里提取 JSON(可能用 ```json ... ``` 包着,也可能纯 JSON)
export function extractJson(text) {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;
  return JSON.parse(jsonStr.trim());
}

// 容错修复:LLM 偶尔吐非法 JSON——最常见是 reason 字符串里有未转义的 "(见
// tests/fixtures/broken-json-01.txt)。保守地把字符串内未转义的 " 转义、删尾随逗号。
// 仅在 JSON.parse 直接失败后调用 → 修坏了也只是继续失败,由上层走 json_object 重问兜底。
export function repairLooseJson(s) {
  const nextNonWs = (i) => { let j = i; while (j < s.length && /\s/.test(s[j])) j++; return s[j]; };
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') {
        const nxt = nextNonWs(i + 1);
        // 后面紧跟结构符 → 真正的字符串结束;否则是串内漏转义的引号
        if (nxt === undefined || nxt === ',' || nxt === '}' || nxt === ']' || nxt === ':') {
          inStr = false; out += ch;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === ',' && (nextNonWs(i + 1) === '}' || nextNonWs(i + 1) === ']')) continue; // 尾随逗号
    out += ch;
  }
  return out;
}

// prose-then-JSON 契约:fence 前的纯文本是 say,fence 内是结构化 JSON。
// 返回 { say, parsed, status }:
//   ok        直接解析成功,或纯 prose 的合法 chat
//   recovered repairLooseJson 修复后解析成功
//   failed    有 JSON 块但修不动 → parsed 退化为 {intent:'chat'};上层据此触发 json_object 重问
export function splitSayAndJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenceMatch) {
    const say = text.slice(0, fenceMatch.index).trim();
    const body = fenceMatch[1].trim();
    try { return { say, parsed: JSON.parse(body), status: 'ok' }; } catch {}
    try { return { say, parsed: JSON.parse(repairLooseJson(body)), status: 'recovered' }; } catch {}
    return { say, parsed: { intent: 'chat' }, status: 'failed' };
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try { return { say: '', parsed: JSON.parse(trimmed), status: 'ok' }; } catch {}
    try { return { say: '', parsed: JSON.parse(repairLooseJson(trimmed)), status: 'recovered' }; } catch {}
    return { say: '', parsed: { intent: 'chat' }, status: 'failed' };
  }
  return { say: trimmed, parsed: { intent: 'chat' }, status: 'ok' };
}

// 流式输出 say(逐字)+ 末尾解析 JSON。
// onSayDelta(deltaText) 仅在 ```` ``` ```` 代码块之前的 prose 区间被调用。
// 返回 { fullText, say, parsed }。claude 无原生流式 → 退化为一次性调用后整段 emit。
export async function callLlmStream({ system, messages, model, trigger, onSayDelta, signal }) {
  const t0 = Date.now();
  let fullText = '';
  let error = null;
  const emitter = makeSayEmitter(onSayDelta);

  try {
    if (model.startsWith('deepseek-')) {
      fullText = await streamOpenAICompatible({
        url: 'https://api.deepseek.com/v1/chat/completions',
        apiKey: requireEnv('DEEPSEEK_API_KEY'),
        model, system, messages, onToken: t => emitter.push(t), signal,
      });
    } else if (model.startsWith('qwen-')) {
      fullText = await streamOpenAICompatible({
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        apiKey: requireEnv('DASHSCOPE_API_KEY'),
        model, system, messages, onToken: t => emitter.push(t), signal,
      });
    } else {
      // claude-* 等无流式后端:整段拿回再一次性 emit say
      fullText = await callLlm({ system, messages, model, trigger });
      emitter.push(fullText);
    }
    emitter.finish();
  } catch (e) {
    error = String(e);
    throw e;
  } finally {
    await logLlmCall({
      model, trigger,
      prompt: JSON.stringify({ system, messages }),
      response: fullText,
      duration_ms: Date.now() - t0,
      error,
    });
  }

  let { say, parsed, status } = splitSayAndJson(fullText);
  // 流式输出修不动(status=failed) → 用非流式 json_object 模式重问一次,拿确定性合法 JSON。
  // 模型上一条已经决定了要做什么,这里只是让它把结构化部分重新吐干净。say 已经流式给过,不动。
  if (status === 'failed') {
    const reasked = await reaskJsonObject({ system, messages, model, trigger });
    if (reasked) { parsed = reasked; status = 'reask'; }
  }
  return { fullText, say, parsed, status };
}

// 非流式 json_object 重问:provider 原生结构化输出保证合法 JSON。call 可注入便于测试。
export async function reaskJsonObject({ system, messages, model, trigger }, call = callLlm) {
  const reMessages = [...messages, {
    role: 'user',
    content: '你上一条回复里的 JSON 没能解析。请只重新输出那个 JSON 对象本身'
      + '(intent / say / play / queueAction / feedback_extract,字段与之前一致),'
      + '不要任何额外文字、解释或代码块标记。字符串里的引号务必转义。',
  }];
  try {
    const raw = await call({ system, messages: reMessages, model, trigger: `${trigger || 'chat'}-reask`, jsonMode: true });
    return extractJson(raw);
  } catch {
    return null;
  }
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set (check .env + npm script uses --env-file)`);
  return v;
}

// 逐 token 累积,只把 fence 之前的 prose 当 say 往外吐。
// HOLDBACK:无 fence 时保留末尾几字,避免把正在成形的 ``` 当作 say。
// exported for unit testing of the streaming say/fence boundary.
export function makeSayEmitter(onSayDelta) {
  let full = '';
  let emitted = 0;
  const HOLDBACK = 3;
  const flushTo = (boundary) => {
    if (boundary > emitted) {
      const delta = full.slice(emitted, boundary);
      emitted = boundary;
      if (delta && onSayDelta) onSayDelta(delta);
    }
  };
  return {
    push(token) {
      if (!token) return;
      full += token;
      const fenceIdx = full.indexOf('```');
      flushTo(fenceIdx >= 0 ? fenceIdx : Math.max(0, full.length - HOLDBACK));
    },
    finish() {
      const fenceIdx = full.indexOf('```');
      flushTo(fenceIdx >= 0 ? fenceIdx : full.length);
    },
  };
}

async function streamOpenAICompatible({ url, apiKey, model, system, messages, onToken, signal }) {
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages);

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: msgs, temperature: 0.7, max_tokens: 8192, stream: true }),
    signal,
  });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => '<no body>');
    throw new Error(`${model} stream ${r.status}: ${text}`);
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
        if (delta) { full += delta; onToken(delta); }
      } catch { /* keep partial SSE frames for next read */ }
    }
  }
  return full;
}
