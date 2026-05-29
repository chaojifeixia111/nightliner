// server/context-builder.js
// 拼装 chat-mode prompt 的 9 个片段（含 netease 曲库 + 推荐池 + 对话历史）
import fs from 'fs/promises';
import db, { recentPlays, recentFeedback, antiList, activeCooldowns, recentChatTurns } from './state-db.js';
import { retrieveContext } from './retriever.js';
import { buildExplorePool, songKey } from './explore-pool.js';

const TEMPLATE_PATH = 'prompts/chat-mode.md';
const SNAPSHOT_PATH = 'data/netease-snapshot.json';
const APPLE_MD_PATH = 'user/apple-music-favorites-2024-2026.md';
const SYSTEM_PATH = 'prompts/system.md';
const USER_TURN_PATH = 'prompts/user-turn.md';

// Playlist ID → chapter tag
const PLAYLIST_TAG = {
  160249544: 'P',  // Prelude/Long Shot 早期
  945616754: 'L',  // Long Shot/Drift 后期
};

// Cache the formatted library string (loaded once)
let _libraryCache = null;

async function readOrEmpty(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}

async function buildLibrarySlice() {
  if (_libraryCache) return _libraryCache;

  let snapshot;
  try {
    snapshot = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf8'));
  } catch {
    _libraryCache = '(netease-snapshot.json 未找到)';
    return _libraryCache;
  }

  const pls = snapshot.playlists;
  // Build deduped list: first playlist wins for tag assignment
  const seen = new Map(); // id → { name, artists, tag }
  for (const pl of Object.values(pls)) {
    const tag = PLAYLIST_TAG[pl.id] || '?';
    for (const song of pl.songs) {
      if (!seen.has(song.id)) {
        seen.set(song.id, { name: song.name, artists: song.artists, tag });
      }
    }
  }

  const lines = [];
  let idx = 1;
  for (const [, s] of seen) {
    lines.push(`${idx}. ${s.name} / ${s.artists} [${s.tag}]`);
    idx++;
  }

  // Append Apple Music library (Melted 章节,2024-2026)
  try {
    const md = await fs.readFile(APPLE_MD_PATH, 'utf8');
    // Match lines like "  1. Title / Artist" (allow leading spaces, allow no leading spaces)
    const trackPattern = /^\s*\d+\.\s+(.+?)\s+\/\s+(.+?)\s*$/gm;
    let m;
    while ((m = trackPattern.exec(md)) !== null) {
      const title = m[1].trim();
      const artist = m[2].trim();
      if (!title || !artist) continue;
      lines.push(`${idx}. ${title} / ${artist} [M]`);
      idx++;
    }
  } catch {
    // Apple Music file optional
  }

  _libraryCache = lines.join('\n');
  return _libraryCache;
}

function fmtPlays(plays) {
  if (!plays.length) return '(无最近播放,这是首次会话)';
  return plays.map(p => {
    const ago = Math.round((Date.now() / 1000 - p.ts) / 60);
    const tag = p.ended_reason || '?';
    return `- ${p.title} / ${p.artist} (${ago}min前, ${tag})`;
  }).join('\n');
}

function fmtFeedback(fbs) {
  if (!fbs.length) return '(无最近反馈)';
  return fbs.map(f => {
    const ago = Math.round((Date.now() / 1000 - f.ts) / 60);
    let reasonPart = '';
    try {
      const ctx = f.context_json ? JSON.parse(f.context_json) : null;
      if (ctx?.reason) reasonPart = ` · 原因:${ctx.reason}`;
    } catch {}
    return `- [${f.signal}] ${f.song_title} / ${f.song_artist} (${ago}min前)${reasonPart}`;
  }).join('\n');
}

function fmtSongList(rows) {
  if (!rows.length) return '(空)';
  return rows.map(r => `- ${r.song_title} / ${r.song_artist}`).join('\n');
}

function fmtRecommendPool(songs) {
  if (!songs || !songs.length) return '(暂无推荐池数据)';
  return songs.map((s, i) => `${i + 1}. ${s.name} / ${s.artist}`).join('\n');
}

function fmtChatHistory(turns) {
  if (!turns || !turns.length) return '(本会话首次对话)';
  // turns from DB are DESC order; reverse to get chronological
  const chronological = [...turns].reverse();
  const now = Math.floor(Date.now() / 1000);
  return chronological.map(t => {
    const minAgo = Math.round((now - t.ts) / 60);
    let lines = `[${minAgo}分钟前 · 用户] ${t.user_message}`;
    lines += `\n[DJ ${t.intent || '?'}] ${t.dj_say || ''}`;
    if (t.intent === 'recommend' && t.play_titles_json) {
      try {
        const plays = JSON.parse(t.play_titles_json);
        if (plays.length) {
          lines += `\n      推: ${plays.map(p => p.title).join(', ')}`;
        }
      } catch {}
    }
    if (t.intent === 'feedback' && t.feedback_extract_json) {
      try {
        const fb = JSON.parse(t.feedback_extract_json);
        lines += `\n      记: target=${fb.target_title || fb.target_category || '?'}, signal=${fb.signal || '?'}, reason=${fb.reason || '?'}`;
      } catch {}
    }
    return lines;
  }).join('\n\n');
}

/**
 * @deprecated Use buildChatMessages instead. Kept for cold-start / chat-once scripts.
 */
export async function buildChatPrompt({ userMessage, currentQueue, n = 5, exploration_pct = 30, recommendPool = [] }) {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const djPersona = await readOrEmpty('user/dj-persona.md');
  const taste = await readOrEmpty('user/taste.md');
  const moodRules = await readOrEmpty('user/mood-rules.md');
  const lifeStages = await readOrEmpty('user/life-stages.md');
  const librarySlice = await buildLibrarySlice();

  const now = new Date();
  const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const chatHistory = recentChatTurns(5);

  return template
    .replace('{{DJ_PERSONA}}', djPersona || '(dj-persona.md 为空)')
    .replace('{{TASTE}}', taste || '(taste.md 尚未生成)')
    .replace('{{MOOD_RULES}}', moodRules || '(mood-rules.md 为空,从空开始)')
    .replace('{{LIFE_STAGES}}', lifeStages || '(life-stages.md 尚未生成)')
    .replace('{{TS}}', now.toISOString())
    .replace('{{DOW}}', dow)
    .replace('{{RECENT_PLAYS}}', fmtPlays(recentPlays(30)))
    .replace('{{RECENT_FEEDBACK}}', fmtFeedback(recentFeedback(20)))
    .replace('{{ANTI_LIST}}', fmtSongList(antiList()))
    .replace('{{COOLDOWNS}}', fmtSongList(activeCooldowns()))
    .replace('{{USER_MESSAGE}}', userMessage)
    .replace('{{CURRENT_QUEUE_OR_EMPTY}}',
      currentQueue && currentQueue.length
        ? currentQueue.map((s, i) => `${i + 1}. ${s.title} / ${s.artist}`).join('\n')
        : '(当前 queue 为空)')
    .replace('{{N}}', String(n))
    .replace('{{EXPLORATION_PCT}}', String(exploration_pct))
    .replace('{{LIBRARY_NETEASE}}', librarySlice)
    .replace('{{CHAT_HISTORY}}', fmtChatHistory(chatHistory))
    .replace('{{RECOMMEND_POOL}}', fmtRecommendPool(recommendPool));
}

function fmtSongs(songs) {
  if (!songs.length) return '(无相关曲库召回)';
  return songs.map((s, i) => `${i + 1}. ${s.name} / ${s.artist} [${s.tag}]`).join('\n');
}
function fmtFeedbackRag(fbs) {
  if (!fbs.length) return '(无相关反馈召回)';
  return fbs.map(f => {
    const ago = Math.round((Date.now() / 1000 - (f.ts || 0)) / 60);
    return `- [${f.signal}] ${f.title} / ${f.artist} (${ago}min前)${f.reason ? ' · ' + f.reason : ''}`;
  }).join('\n');
}
function fmtSnippets(arr, empty = '(无相关召回)') {
  if (!arr.length) return empty;
  return arr.map((s, i) => `### snippet ${i + 1}\n${s}`).join('\n\n');
}
function fmtExplorePool(cands) {
  if (!cands || !cands.length) return '(无 explore 候选 — 当前没合适的相似歌种子)';
  return cands.map((c, i) => {
    const via = c.via?.length ? `(灵感来自 ${c.via.map(v => `«${v}»`).join('、')})` : '';
    return `${i + 1}. ${c.name} / ${c.artist} ${via}`.trim();
  }).join('\n');
}

export async function buildChatMessages({
  userMessage, currentQueue, n = 5, exploration_pct = 30,
  recommendPool = [], now = null,
}) {
  const [systemTpl, userTpl, djPersona] = await Promise.all([
    fs.readFile(SYSTEM_PATH, 'utf8'),
    fs.readFile(USER_TURN_PATH, 'utf8'),
    readOrEmpty('user/dj-persona.md'),
  ]);

  // RAG 检索 与 推荐池拉取并行(推荐池冷缓存时是一次 NCM 网络往返,与 embedding 检索重叠掉)
  const [retrieved, resolvedPool] = await Promise.all([
    retrieveContext({
      userMessage,
      recentTurns: [],
      budgets: { song: 18, feedback: 8, life_stage: 3, taste: 3, mood_rule: 2, vibe_anchor: 5, chat_turn: 3 },
    }),
    Promise.resolve(recommendPool), // 可传 array 或 promise
  ]);

  const system = systemTpl.replace('{{DJ_PERSONA}}', djPersona || '(dj-persona.md 为空)');

  const dt = new Date();
  const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dt.getDay()];
  const libPct = 100 - exploration_pct;
  const recPct = Math.round(exploration_pct * 0.7);
  const wildPct = exploration_pct - recPct;

  // wildcard 桶 = 相似歌探索池。只在有 wildcard 配额时才拉(exp=0 时跳过,省一次往返)。
  // 种子:now-playing + RAG 召回的曲库歌(都带数字 ncm_id 且贴合当前语境)。
  let explorePool = [];
  if (wildPct > 0) {
    const seeds = [];
    if (now && typeof now.ncm_id === 'number') {
      seeds.push({ ncm_id: now.ncm_id, name: now.title, artist: now.artist });
    }
    // 随机抽种子(而非每次都取 RAG 前几名)→ 每次相邻探索命中不同的近邻,
    // 避免反复推同几首。retrieved.songs 对同一 query 是确定的,这里靠 shuffle 引入变化。
    const seedPool = retrieved.songs.filter(s => typeof s.ncm_id === 'number');
    for (let i = seedPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seedPool[i], seedPool[j]] = [seedPool[j], seedPool[i]];
    }
    for (const s of seedPool) {
      if (seeds.length >= 5) break;
      seeds.push({ ncm_id: s.ncm_id, name: s.name, artist: s.artist });
    }
    if (seeds.length) {
      const excludeKeys = new Set();
      for (const a of antiList()) excludeKeys.add(songKey(a.song_title, a.song_artist));
      for (const c of activeCooldowns()) excludeKeys.add(songKey(c.song_title, c.song_artist));
      for (const p of recentPlays(20)) excludeKeys.add(songKey(p.title, p.artist));
      for (const f of recentFeedback(20)) {
        if (f.signal === 'wrong_vibe' || f.signal === 'never_again') {
          excludeKeys.add(songKey(f.song_title, f.song_artist));
        }
      }
      explorePool = await buildExplorePool({ seeds, excludeKeys, perSeedCap: 2, limit: 12 })
        .catch(e => { console.warn('[explore] pool failed:', e.message); return []; });
    }
  }

  const userContent = userTpl
    .replace('{{USER_MESSAGE}}', userMessage)
    .replace('{{NOW_PLAYING}}', now ? `${now.title} / ${now.artist}` : '(无)')
    .replace('{{CURRENT_QUEUE}}', currentQueue?.length
      ? currentQueue.map((s, i) => `${i + 1}. ${s.title} / ${s.artist}`).join('\n')
      : '(当前 queue 为空)')
    .replace('{{TS}}', dt.toISOString())
    .replace('{{DOW}}', dow)
    .replace('{{EXPLORATION_PCT}}', String(exploration_pct))
    .replace('{{LIB_PCT}}', String(libPct))
    .replace('{{REC_PCT}}', String(recPct))
    .replace('{{WILD_PCT}}', String(wildPct))
    .replace('{{N_SONGS}}', String(retrieved.songs.length))
    .replace('{{N}}', String(n))
    .replace('{{LIBRARY_SLICE}}', fmtSongs(retrieved.songs))
    .replace('{{RECOMMEND_POOL}}', resolvedPool.length
      ? resolvedPool.slice(0, 20).map((s, i) => `${i + 1}. ${s.name} / ${s.artist}`).join('\n')
      : '(今天的每日推荐没拉到 —— 可能 cookie 过期或本地 NCM 服务未启动;本轮没有 recommend 池,别凭空编 recommend 歌)')
    .replace('{{EXPLORE_POOL}}', fmtExplorePool(explorePool))
    .replace('{{FEEDBACK_SLICE}}', fmtFeedbackRag(retrieved.feedback))
    .replace('{{TASTE_SLICE}}', fmtSnippets(retrieved.taste_snippets))
    .replace('{{LIFE_STAGE_SLICE}}', fmtSnippets(retrieved.life_stage_snippets))
    .replace('{{MOOD_RULE_SLICE}}', fmtSnippets(retrieved.mood_rule_snippets))
    .replace('{{VIBE_ANCHOR_SLICE}}', fmtSnippets(retrieved.vibe_anchor_snippets, '(vibe-anchors.md 不存在或无相关)'))
    .replace('{{SEMANTIC_HISTORY}}', fmtSnippets(retrieved.semantic_history))
    .replace('{{ANTI_LIST}}', fmtSongList(antiList()))
    .replace('{{COOLDOWNS}}', fmtSongList(activeCooldowns()))
    .replace('{{RECENT_PLAYS}}', fmtPlays(recentPlays(12)));

  // 多轮 messages: 把最近 5 轮 chat_turns 转成 user/assistant 对
  const turns = recentChatTurns(5);
  const chronological = [...turns].reverse();
  const messages = [];
  for (const t of chronological) {
    messages.push({ role: 'user', content: t.user_message });
    // 回放过去 DJ 输出,沿用 prose-then-JSON 契约:say 在前(纯文本),JSON 不含 say
    const assistantPayload = {
      intent: t.intent || 'chat',
      play: t.play_titles_json ? JSON.parse(t.play_titles_json).map(p => ({ title: p.title, artist: p.artist })) : [],
      queueAction: t.queue_action || null,
      feedback_extract: t.feedback_extract_json ? JSON.parse(t.feedback_extract_json) : null,
    };
    const sayEcho = (t.dj_say || '').trim();
    messages.push({
      role: 'assistant',
      content: (sayEcho ? sayEcho + '\n\n' : '') + '```json\n' + JSON.stringify(assistantPayload) + '\n```',
    });
  }
  messages.push({ role: 'user', content: userContent });

  return { system, messages };
}
