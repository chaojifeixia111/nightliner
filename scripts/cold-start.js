// scripts/cold-start.js
// 拼装 cold-start prompt → 调 claude opus → 解析 JSON → 写 user/taste.md 和 user/life-stages.md
// 注意:本月 v0.4 的初版 taste.md / life-stages.md 是在主 Opus 会话里直接生成的,
// 这个脚本是为未来重跑(比如歌单更新)准备的。
import fs from 'fs/promises';
import { spawn } from 'child_process';

const TEMPLATE_PATH = 'prompts/cold-start-taste.md';
const DJ_PERSONA_PATH = 'user/dj-persona.md';
const APPLE_PLAYLIST_PATH = 'user/apple-music-favorites-2024-2026.md';
const NETEASE_SNAPSHOT_PATH = 'data/netease-snapshot.json';
const FREE_DESC_PATH = 'user/free-taste-description.txt'; // 可选
const TASTE_OUT = 'user/taste.md';
const LIFE_STAGES_OUT = 'user/life-stages.md';

async function readOrEmpty(path) {
  try { return await fs.readFile(path, 'utf8'); }
  catch { return ''; }
}

function netesePlaylistToText(p) {
  const lines = [`歌单元数据: ${p.label} | ${p.time_range} | 共 ${p.track_count_fetched} 首`];
  p.songs.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.name} / ${s.artists}`);
  });
  return lines.join('\n');
}

async function buildPrompt() {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const djPersona = await fs.readFile(DJ_PERSONA_PATH, 'utf8');
  const applePlaylist = await fs.readFile(APPLE_PLAYLIST_PATH, 'utf8');
  const snapshot = JSON.parse(await fs.readFile(NETEASE_SNAPSHOT_PATH, 'utf8'));
  const freeDesc = await readOrEmpty(FREE_DESC_PATH);

  const p1 = snapshot.playlists.find(p => p.id === '160249544');
  const p2 = snapshot.playlists.find(p => p.id === '945616754');

  return template
    .replace('{{DJ_PERSONA}}', djPersona)
    .replace('{{NETEASE_PLAYLIST_1}}', p1 ? netesePlaylistToText(p1) : '(歌单 1 数据未拉取)')
    .replace('{{NETEASE_PLAYLIST_2}}', p2 ? netesePlaylistToText(p2) : '(歌单 2 数据未拉取)')
    .replace('{{APPLE_MUSIC_PLAYLIST}}', applePlaylist)
    .replace('{{USER_FREE_DESCRIPTION_OR_EMPTY}}', freeDesc.trim() || '(用户暂未提供自由描述,基于歌单本身分析)');
}

function callClaude(prompt, model = 'claude-opus-4-7') {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', '--model', model], {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true, // Windows 上找 claude.cmd
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
}

function extractInnerJson(claudeRawOutput) {
  // claude -p --output-format json 返回 { result: "<assistant text>" } 之类
  // 我们要的 JSON 在 result 字段内,可能用 ```json ... ``` 包着
  const wrapper = JSON.parse(claudeRawOutput);
  const innerText = wrapper.result || wrapper.message || JSON.stringify(wrapper);
  // 从 inner text 提取第一段 ```json ... ``` 或纯 JSON
  const codeBlockMatch = innerText.match(/```(?:json)?\s*([\s\S]+?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : innerText;
  return JSON.parse(jsonStr);
}

async function main() {
  console.log('1. 拼装 prompt...');
  const prompt = await buildPrompt();
  console.log(`   prompt 长度: ${prompt.length} 字符`);

  console.log('2. 调 Claude Opus(可能需要 30-90 秒)...');
  const t0 = Date.now();
  const raw = await callClaude(prompt);
  console.log(`   ✓ ${Date.now() - t0}ms`);

  console.log('3. 解析 JSON...');
  const parsed = extractInnerJson(raw);

  console.log('4. 写文件...');
  await fs.writeFile(TASTE_OUT, parsed.taste_md, 'utf8');
  await fs.writeFile(LIFE_STAGES_OUT, parsed.life_stages_md, 'utf8');

  console.log(`   ✓ ${TASTE_OUT}`);
  console.log(`   ✓ ${LIFE_STAGES_OUT}`);

  console.log('\n5. Opus 的观察(供 Elliot 参考):');
  for (const obs of parsed.observations || []) {
    console.log(`   • ${obs}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
