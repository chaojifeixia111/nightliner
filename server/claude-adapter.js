// server/claude-adapter.js
// claude -p 子进程调用,返回 assistant 输出文本(不解析 JSON,留给 caller)
import { spawn } from 'child_process';
import { logLlmCall } from './llm-logger.js';

export async function callClaude({ prompt, model, trigger }) {
  const t0 = Date.now();
  let response = '';
  let error = null;

  try {
    response = await new Promise((resolve, reject) => {
      const child = spawn('claude', ['-p', '--output-format', 'json', '--model', model], {
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: true,
      });
      let stdout = '';
      child.stdout.on('data', d => stdout += d.toString());
      child.on('close', code => {
        if (code !== 0) reject(new Error(`claude exited ${code}`));
        else resolve(stdout);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  } catch (e) {
    error = String(e);
    throw e;
  } finally {
    await logLlmCall({
      model,
      trigger,
      prompt,
      response,
      duration_ms: Date.now() - t0,
      error,
    });
  }

  // claude -p 包了一层 wrapper { result: "<assistant text>", ... }
  const wrapper = JSON.parse(response);
  return wrapper.result || wrapper.message || response;
}

// 从 Claude 输出文本里提取 JSON(可能用 ```json ... ``` 包着)
export function extractJson(text) {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;
  return JSON.parse(jsonStr.trim());
}
