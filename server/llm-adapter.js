// server/llm-adapter.js
// 多 provider 路由:按 model 名前缀分发到对应后端
//   claude-*    → claude CLI 子进程(走 Anthropic 订阅)
//   deepseek-*  → HTTP 调 DeepSeek API(OpenAI 兼容)
//   qwen-*      → HTTP 调阿里 DashScope(OpenAI 兼容,预留)
import { spawn } from 'child_process';
import { logLlmCall } from './llm-logger.js';

export async function callLlm({ prompt, model, trigger, jsonMode = false }) {
  const t0 = Date.now();
  let response = '';
  let error = null;

  try {
    if (model.startsWith('claude-')) {
      response = await callClaudeCli(prompt, model);
    } else if (model.startsWith('deepseek-')) {
      response = await callDeepSeek(prompt, model, jsonMode);
    } else if (model.startsWith('qwen-')) {
      response = await callQwen(prompt, model, jsonMode);
    } else {
      throw new Error(`Unknown model provider for: ${model}`);
    }
  } catch (e) {
    error = String(e);
    throw e;
  } finally {
    await logLlmCall({
      model, trigger, prompt, response,
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

// 从 LLM 输出文本里提取 JSON(可能用 ```json ... ``` 包着,也可能纯 JSON)
export function extractJson(text) {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;
  return JSON.parse(jsonStr.trim());
}
