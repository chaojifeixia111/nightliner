// server/llm-logger.js
// 每次 Claude 调用的 prompt + 响应 + 耗时全部追加到 data/llm-calls.jsonl
import fs from 'fs/promises';
import path from 'path';

const LOG_PATH = 'data/llm-calls.jsonl';

export async function logLlmCall(entry) {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  const line = JSON.stringify({
    ts: entry.ts || new Date().toISOString(),
    model: entry.model,
    trigger: entry.trigger,
    prompt: entry.prompt,
    response: entry.response,
    duration_ms: entry.duration_ms,
    error: entry.error || null,
  }) + '\n';
  await fs.appendFile(LOG_PATH, line, 'utf8');
}
