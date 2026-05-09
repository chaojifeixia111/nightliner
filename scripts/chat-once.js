// scripts/chat-once.js
// 命令行原型:接一句用户输入,跑一次完整 chat 流程,打印 {say, play, ...} JSON
import { buildChatPrompt } from '../server/context-builder.js';
import { callClaude, extractJson } from '../server/claude-adapter.js';
import yaml from 'yaml';
import fs from 'fs/promises';

async function loadConfig() {
  return yaml.parse(await fs.readFile('config.yaml', 'utf8'));
}

async function main() {
  const userMessage = process.argv.slice(2).join(' ');
  if (!userMessage) {
    console.error('用法: node scripts/chat-once.js "我想听点高中刷题时听的"');
    process.exit(1);
  }

  const config = await loadConfig();
  const model = config.models.chat_mode;

  console.log(`>>> 用户: ${userMessage}\n`);

  const prompt = await buildChatPrompt({ userMessage, currentQueue: [], n: 5 });
  console.log(`(prompt 长度: ${prompt.length} 字符,模型: ${model})\n`);

  const t0 = Date.now();
  const raw = await callClaude({ prompt, model, trigger: 'chat-once-cli' });
  console.log(`(Claude 耗时: ${Date.now() - t0}ms)\n`);

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    console.error('JSON 解析失败,原始输出:');
    console.error(raw);
    process.exit(1);
  }

  console.log('>>> DJ:');
  console.log('say:', parsed.say);
  console.log('\nplay:');
  parsed.play.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.title} / ${s.artist}`);
    console.log(`     reason: ${s.reason}`);
    console.log(`     memoryLink: ${s.memoryLink || 'null'}`);
    console.log(`     confidence: ${s.confidence}`);
  });
  if (parsed.queueAction) console.log(`\nqueueAction: ${parsed.queueAction}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
