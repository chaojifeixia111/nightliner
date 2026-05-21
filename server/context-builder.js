// server/context-builder.js
// 拼装 chat-mode prompt 的 9 个片段（含 netease 曲库 + 推荐池 + 对话历史）
import fs from 'fs/promises';
import db, { recentPlays, recentFeedback, antiList, activeCooldowns, recentChatTurns } from './state-db.js';

const TEMPLATE_PATH = 'prompts/chat-mode.md';
const SNAPSHOT_PATH = 'data/netease-snapshot.json';
const APPLE_MD_PATH = 'user/apple-music-favorites-2024-2026.md';

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
    return `- [${f.signal}] ${f.song_title} / ${f.song_artist} (${ago}min前)`;
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
