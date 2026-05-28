// scripts/smoke-rag.js
// 跑两轮 chat 验证 RAG + 多轮记忆 + budget enforcement
import { warmup } from '../server/embedder.js';
import { buildChatMessages } from '../server/context-builder.js';
import { callLlm, extractJson } from '../server/llm-adapter.js';
import { recordChatTurn } from '../server/state-db.js';
import { enforceSourcePoolBudget } from '../server/budget-enforcer.js';
import yaml from 'yaml';
import fs from 'fs/promises';

const config = yaml.parse(await fs.readFile('config.yaml', 'utf8'));
await warmup();
console.log('[smoke] embedder ready');

const turnsLog = [];

async function turn(userMsg) {
  const t0 = Date.now();
  const { system, messages } = await buildChatMessages({
    userMessage: userMsg,
    currentQueue: [],
    n: 5,
    exploration_pct: 30,
    recommendPool: [],
  });
  const promptBytes = system.length + messages.reduce((s, m) => s + m.content.length, 0);
  const raw = await callLlm({ system, messages, model: config.models.chat_mode, trigger: 'smoke' });
  const parsed = extractJson(raw);
  const dt = Date.now() - t0;
  console.log(`\n[smoke] "${userMsg}"`);
  console.log(`  prompt: ${(promptBytes / 1024).toFixed(1)}KB, elapsed: ${(dt / 1000).toFixed(1)}s`);
  console.log(`  intent: ${parsed.intent}, plays: ${parsed.play?.length || 0}`);
  if (parsed.play?.length) {
    for (const p of parsed.play) {
      console.log(`    - ${p.title} / ${p.artist} [${p.source_pool}] · ${(p.reason || '').slice(0, 60)}`);
    }
    const budget = enforceSourcePoolBudget(parsed.play, { lib: 70, rec: 21, wild: 9 });
    console.log(`  budget ok=${budget.ok}, deviation=${(budget.deviation * 100).toFixed(0)}%`);
  }
  // 记入 state.db,这样 turn 2 才能在 buildChatMessages 里看到 turn 1
  recordChatTurn({
    user_message: userMsg,
    intent: parsed.intent,
    dj_say: parsed.say,
    play_titles_json: JSON.stringify(parsed.play?.map(p => ({ title: p.title, artist: p.artist })) || []),
    queue_action: parsed.queueAction,
    feedback_extract_json: null,
    context_now_title: null,
    context_now_artist: null,
  });
  turnsLog.push({ user: userMsg, plays: parsed.play || [], dt, promptBytes });
  return parsed;
}

const t1 = await turn('推荐几首 KPOP');
const t2 = await turn('换一批全是女声的');

// 验证: 两轮的歌至少 70% 不重复
const set1 = new Set(turnsLog[0].plays.map(p => p.title));
const set2 = new Set(turnsLog[1].plays.map(p => p.title));
const overlap = [...set1].filter(t => set2.has(t));
const overlapPct = set1.size ? (overlap.length / set1.size) * 100 : 0;
console.log(`\n[smoke] overlap between turn 1 and turn 2: ${overlap.length}/${set1.size} (${overlapPct.toFixed(0)}%)`);
console.log(`[smoke] expected: < 30% (refinement should produce mostly fresh plays)`);

console.log('\n[smoke] done');
