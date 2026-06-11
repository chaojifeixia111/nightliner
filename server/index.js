// server/index.js
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import yaml from 'yaml';
import fs from 'fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildChatMessages, libraryArtistNames } from './context-builder.js';
import { repairFamiliarNew } from './align-batch.js';
import { detectDirection, carriesDirection, isOpenReset, describeDirection } from './direction.js';
import { callLlm, extractJson, callLlmStream } from './llm-adapter.js';
import { resolvePlayList } from './playback-coordinator.js';
import { recordFeedback, recordPlay, recordQueue, recordChatTurn, recentChatTurns, antiList, activeCooldowns, feedbackStats } from './state-db.js';
import { recommendSongs, personalFm } from './ncm-client.js';
import { warmup } from './embedder.js';
import { indexAllSongs, indexAllFeedback, indexAllChatTurns, indexMdFile } from './indexer.js';
import { checkReasonHallucination } from './budget-enforcer.js';

const config = yaml.parse(await fs.readFile('config.yaml', 'utf8'));
const PORT = config.server.port;

const app = express();
app.use(express.json());
app.use(express.static('pwa/dist')); // 生产构建产物;开发时用 vite proxy

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });

const broadcast = (msg) => {
  const json = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(json);
  }
};

// In-memory current queue + now playing
let currentQueue = [];
let now = null;
// 当前「方向」硬约束(语种/性别/艺人):新方向覆盖,"下一批/继续" 沿用,其它消息清空
let currentDirection = null;

// Play history stack for ⏮ previous track (max 30 entries)
let playHistory = [];

// Tuning state — persisted to disk so它不会每次重启回弹默认值
const TUNING_PATH = 'data/tuning.json';
let tuning = {
  exploration_pct: 30,
  queue_length: 10,
};
try {
  // 只取已知字段:旧存档里的废弃键(如 chattiness)在下次 persist 时自然消失
  const saved = JSON.parse(readFileSync(TUNING_PATH, 'utf8'));
  for (const k of Object.keys(tuning)) if (saved[k] !== undefined) tuning[k] = saved[k];
} catch { /* 没有存档就用默认值 */ }

function persistTuning() {
  try {
    writeFileSync(TUNING_PATH, JSON.stringify(tuning, null, 2));
  } catch (e) {
    console.warn('[tuning] persist failed:', e.message);
  }
}

// Recommend pool cache (refreshed every 30 min)
let recommendCache = { ts: 0, songs: [] };

async function getRecommendPool() {
  const THIRTY_MIN = 30 * 60 * 1000;
  if (Date.now() - recommendCache.ts < THIRTY_MIN && recommendCache.songs.length) {
    return recommendCache.songs;
  }
  const byId = new Map();
  const add = (s) => {
    if (!s || s.id == null || !s.name) return;
    if (byId.has(s.id)) return;
    byId.set(s.id, { name: s.name, artist: (s.ar || s.artists || []).map(a => a.name).join(' / '), ncm_id: s.id });
  };
  try {
    const data = await recommendSongs(30);
    for (const s of (data?.data?.dailySongs || [])) add(s);
    // 叠加 personal_fm:每次返回不同的几首 → 给推荐池注入会轮换的新鲜血液(抓两次拿更多)
    const fmResults = await Promise.allSettled([personalFm(), personalFm()]);
    for (const r of fmResults) {
      if (r.status === 'fulfilled') for (const s of (r.value?.data || [])) add(s);
    }
    const songs = [...byId.values()];
    if (songs.length) {
      recommendCache = { ts: Date.now(), songs };
      console.log(`[recommend] pool refreshed: ${songs.length} songs (daily + fm)`);
    }
  } catch (e) {
    console.warn('[recommend] pool fetch failed:', e.message);
  }
  return recommendCache.songs;
}

// Netease snapshot cache for hit-rate stats
let _snapshotNorm = null;
async function getSnapshotNorm() {
  if (_snapshotNorm) return _snapshotNorm;
  try {
    const raw = JSON.parse(await fs.readFile('data/netease-snapshot.json', 'utf8'));
    const norm = s => (s || '').toLowerCase().replace(/[\s·・\(\)（）,，。.!！?？]/g, '');
    const entries = [];
    for (const pl of Object.values(raw.playlists)) {
      for (const song of pl.songs) {
        entries.push({
          normName: norm(song.name),
          normArtist: norm(song.artists),
        });
      }
    }
    _snapshotNorm = { entries, norm };
  } catch {
    _snapshotNorm = { entries: [], norm: s => s };
  }
  return _snapshotNorm;
}

function matchesLibrary(title, artist, snapshotNorm) {
  const { entries, norm } = snapshotNorm;
  const t = norm(title);
  const a = norm(artist).split('/')[0].trim();
  return entries.some(e => e.normName === t && e.normArtist.includes(a));
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'now', data: now }));
  ws.send(JSON.stringify({ type: 'queue', data: currentQueue }));
  ws.send(JSON.stringify({ type: 'tuning', data: tuning }));
});

// GET /api/tuning
app.get('/api/tuning', (req, res) => res.json(tuning));

// POST /api/tuning
app.post('/api/tuning', (req, res) => {
  const { exploration_pct, queue_length } = req.body;
  if (exploration_pct !== undefined) tuning.exploration_pct = Number(exploration_pct);
  if (queue_length !== undefined) tuning.queue_length = Number(queue_length);
  persistTuning();
  broadcast({ type: 'tuning', data: tuning });
  res.json({ ok: true, tuning });
});

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.json({ ok: true, status: 'thinking' });
  broadcast({ type: 'thinking', data: true });

  const ts = new Date().toISOString();
  const streamId = `s${Date.now()}`;
  let streamStarted = false;
  let streamedSay = '';
  const onSayDelta = (delta) => {
    if (!streamStarted) {
      broadcast({ type: 'dj_stream_start', data: { id: streamId, ts } });
      broadcast({ type: 'thinking', data: false });
      streamStarted = true;
    }
    streamedSay += delta;
    broadcast({ type: 'dj_stream_delta', data: { id: streamId, delta } });
  };

  try {
    // 方向解析:新方向覆盖;明确放开则清空;纠正/追问/续批沿用上一轮;否则(全新请求)清空。
    // 关键:用户纠正上一批("怎么又是X""第一首不是说放Y吗")要沿用方向,别把锁清掉。
    const detected = detectDirection(message, { artistNames: await libraryArtistNames() });
    if (detected) {
      currentDirection = detected;                                   // 新方向覆盖
    } else if (isOpenReset(message)) {
      currentDirection = null;                                       // 明确放开 → 开放推荐
    } else if (currentDirection && carriesDirection(message)) {
      /* 纠正 / 追问 / 续批 → 沿用上一轮方向 */
    } else {
      currentDirection = null;                                       // 全新的请求 → 清空
    }
    if (currentDirection) console.log(`[chat] 方向=${describeDirection(currentDirection)}${detected ? '' : ' (沿用上轮)'}`);

    const recommendPoolP = getRecommendPool(); // 与 RAG 检索并行,buildChatMessages 内部 await
    const { system, messages, meta } = await buildChatMessages({
      userMessage: message,
      currentQueue,
      n: tuning.queue_length,
      exploration_pct: tuning.exploration_pct,
      recommendPool: recommendPoolP,
      now,
      direction: currentDirection,
    });

    const { say: parsedSay, parsed } = await callLlmStream({
      system, messages, model: config.models.chat_mode, trigger: 'chat', onSayDelta,
    });

    const intent = parsed.intent || 'recommend';
    // say 优先用流式累积的;模型若把话塞进 JSON(旧习惯)或直接吐 JSON 则回退
    const say = (streamedSay.trim() || parsedSay || parsed.say || '').trim();
    // 模型没流式 prose(直接 JSON)但有 say → 补发一气泡
    if (!streamStarted && say) {
      broadcast({ type: 'dj_stream_start', data: { id: streamId, ts } });
      broadcast({ type: 'thinking', data: false });
      broadcast({ type: 'dj_stream_delta', data: { id: streamId, delta: say } });
      streamStarted = true;
    }
    if (streamStarted) broadcast({ type: 'dj_stream_end', data: { id: streamId, say } });
    console.log(`[chat] intent=${intent}, say="${say.slice(0, 40)}..."`);

    // Memory tracking
    let recordedPlayTitles = [];
    let recordedFeedback = null;

    if (intent === 'recommend') {
      // Resolve play list → NCM URLs
      const plays = Array.isArray(parsed.play) ? parsed.play : [];

      // === Familiar↔new 硬对齐(替代旧 source_pool budget retry)===
      // 模型已在 prompt 里被告知本批确切的「库内 X / 全新 Y」。这里不信它自报的 source_pool,
      // 用真实曲库判定每首库内/全新,多退少补(确定性换槽,不重试)→ 探索档位比例必然落地。
      if (meta?.famTarget != null) {
        const r = repairFamiliarNew(plays, meta);
        parsed.play = plays;
        const dirLog = meta.direction ? ` 方向=${describeDirection(meta.direction)}` : '';
        console.log(`[chat]${dirLog} 档位=${meta.mode.name} 目标库内${meta.famTarget}/全新${meta.newTarget} | 模型给库内${r.before} → 校正后库内${r.familiar}/全新${r.newCount}${r.repaired ? ` (换${r.repaired}槽${r.offDir ? `,其中跨方向${r.offDir}` : ''})` : ''}`);
      }

      // === Hallucination check (T17, best effort, only log + mask reason) ===
      const evidenceStr = messages[messages.length - 1]?.content || '';
      const hallu = checkReasonHallucination(plays, evidenceStr);
      if (hallu.length) {
        console.warn(`[chat] hallucination suspects in ${hallu.length} reasons: ${hallu.map(h => `play[${h.play_idx}]: ${h.suspect_terms.join(',')}`).join('; ')}`);
        for (const h of hallu) {
          plays[h.play_idx].reason = `(reason 含未验证细节,已隐藏) ${plays[h.play_idx].title}`;
        }
      }

      const resolved = await resolvePlayList(plays);
      const playable = resolved.filter(s => s.found);

      // Compute hit stats
      const snapshotNorm = await getSnapshotNorm();
      let library_hits = 0;
      let recommendHits = 0;
      let wildcard = 0;
      for (let i = 0; i < plays.length; i++) {
        const sp = plays[i]?.source_pool || '';
        if (sp === 'library') library_hits++;
        else if (sp === 'recommend') recommendHits++;
        else wildcard++;
      }
      console.log(`[chat] queueAction=${parsed.queueAction}, library_hits=${library_hits}/${plays.length}`);

      if (parsed.queueAction === 'rewrite_tail' && currentQueue.length) {
        const idxNow = now ? currentQueue.findIndex(s => s.title === now.title) : -1;
        const head = idxNow >= 0 ? [currentQueue[idxNow]] : [];
        currentQueue = [...head, ...playable];
      } else if (parsed.queueAction === 'insert_next') {
        const idxNow = now ? currentQueue.findIndex(s => s.title === now.title) : -1;
        currentQueue.splice(idxNow + 1, 0, ...playable);
      } else {
        currentQueue = playable;
        now = playable[0] || null;
      }

      recordQueue({ mode: 'chat', songs: currentQueue });
      broadcast({ type: 'queue', data: currentQueue });
      broadcast({ type: 'now', data: now });

      // DJ opening 已通过 dj_stream_* 流式给到前端,这里不再重复广播
      // Per-song reasons
      for (let i = 0; i < playable.length; i++) {
        const s = playable[i];
        const reason = s.reason || '';
        if (reason) {
          broadcast({ type: 'dj_message', data: { ts, kind: 'song', title: s.title, text: reason } });
        }
      }

      // Stats broadcast
      const vip_skipped = resolved.filter(s => !s.found && s.ncm_id).length;
      const not_found = resolved.filter(s => !s.found && !s.ncm_id).length;
      broadcast({
        type: 'stats',
        data: {
          library_hits,
          recommend: recommendHits,
          wildcard,
          vip_skipped,
          not_found,
          total: plays.length,
        },
      });

      recordedPlayTitles = plays.map(p => ({ title: p.title, artist: p.artist }));

    } else if (intent === 'feedback') {
      const fb = parsed.feedback_extract;
      if (fb) {
        const isCategory = !!fb.target_category && !fb.target_title;
        recordFeedback({
          song_title: fb.target_title || fb.target_category || '(unknown)',
          song_artist: fb.target_artist || '(category)',
          signal: fb.signal,
          context_json: { reason: fb.reason, source: 'chat_extracted', scope: isCategory ? 'category' : 'song' },
        });
        recordedFeedback = fb;

        // DJ 口头确认已流式给到前端;这里只补一条结构化 system 确认
        // Broadcast system confirmation
        const target = fb.target_title
          ? `"${fb.target_title} / ${fb.target_artist}"`
          : `"${fb.target_category}"`;
        const sigLabel = { love: '❤ love', wrong_vibe: '✗ wrong_vibe', too_familiar: '🔁 too_familiar', never_again: '🚫 never_again' }[fb.signal] || fb.signal;
        broadcast({ type: 'dj_message', data: {
          ts, kind: 'system',
          text: `记住了 — ${target} 标记为 ${sigLabel}${fb.reason ? ' · ' + fb.reason : ''}`,
        }});
      }

    } else {
      // intent === 'chat': say 已流式给到前端,无 queue 变化,这里无需再广播
    }

    broadcast({ type: 'thinking', data: false });

    // Always record the turn for persistent memory
    recordChatTurn({
      user_message: message,
      intent,
      dj_say: say,
      play_titles_json: JSON.stringify(recordedPlayTitles),
      queue_action: parsed.queueAction || null,
      feedback_extract_json: recordedFeedback ? JSON.stringify(recordedFeedback) : null,
      context_now_title: now?.title || null,
      context_now_artist: now?.artist || null,
    });

  } catch (e) {
    console.error('chat error:', e);
    broadcast({ type: 'thinking', data: false });
    // 若已开了流式气泡,先收尾,避免前端留一个永远在打字的空泡
    if (streamStarted) broadcast({ type: 'dj_stream_end', data: { id: streamId, say: streamedSay.trim() } });
    broadcast({ type: 'dj_message', data: { ts: new Date().toISOString(), kind: 'system', text: '出错了:' + e.message } });
  }
});

// GET /api/now
app.get('/api/now', (req, res) => res.json(now));

// GET /api/queue
app.get('/api/queue', (req, res) => res.json(currentQueue));

// POST /api/feedback
app.post('/api/feedback', (req, res) => {
  const { title, artist, signal, reason } = req.body;
  if (!title || !artist || !signal) return res.status(400).json({ error: 'fields missing' });
  recordFeedback({
    song_title: title,
    song_artist: artist,
    signal,
    context_json: reason ? { reason, source: 'button' } : { source: 'button' },
  });
  res.json({ ok: true });
  // Broadcast confirmation
  const sigLabel = {
    love: '❤ love',
    wrong_vibe: '✗ wrong_vibe',
    too_familiar: '🔁 too_familiar',
    never_again: '🚫 never_again',
  }[signal] || signal;
  const reasonSuffix = reason ? ` · ${reason}` : '';
  broadcast({ type: 'dj_message', data: {
    ts: new Date().toISOString(), kind: 'system',
    text: `记住了 — "${title} / ${artist}" 标记为 ${sigLabel}${reasonSuffix}`,
  }});
});

// POST /api/play-event
app.post('/api/play-event', (req, res) => {
  const e = req.body;
  recordPlay({
    title: e.title,
    artist: e.artist,
    duration_sec: e.duration_sec,
    played_sec: e.played_sec,
    ended_reason: e.ended_reason,
  });
  if (e.ended_reason === 'natural' || e.ended_reason === 'user_skip') {
    const idx = currentQueue.findIndex(s => s.title === e.title);
    if (idx >= 0 && idx + 1 < currentQueue.length) {
      if (now) {
        playHistory.push(now);
        if (playHistory.length > 30) playHistory.shift();
      }
      now = currentQueue[idx + 1];
      broadcast({ type: 'now', data: now });
    } else {
      now = null;
      broadcast({ type: 'now', data: null });
      broadcast({ type: 'dj_message', data: { ts: new Date().toISOString(), kind: 'opening', text: 'queue 结束。再来一段?' } });
    }
  }
  res.json({ ok: true });
});

// POST /api/skip — explicit skip with play-event recording
app.post('/api/skip', (req, res) => {
  const { title, artist, played_sec } = req.body;
  if (!title || !artist) return res.status(400).json({ error: 'title and artist required' });

  recordPlay({
    title,
    artist,
    duration_sec: 0,
    played_sec: played_sec || 0,
    ended_reason: 'user_skip',
  });

  const idx = currentQueue.findIndex(s => s.title === title);
  if (idx >= 0 && idx + 1 < currentQueue.length) {
    if (now) {
      playHistory.push(now);
      if (playHistory.length > 30) playHistory.shift();
    }
    now = currentQueue[idx + 1];
    broadcast({ type: 'now', data: now });
  } else {
    now = null;
    broadcast({ type: 'now', data: null });
  }

  res.json({ ok: true, now });
});

// POST /api/skip-to — jump to a specific song in queue
app.post('/api/skip-to', (req, res) => {
  const { title, artist } = req.body;
  if (!title || !artist) return res.status(400).json({ error: 'title and artist required' });

  const idx = currentQueue.findIndex(s => s.title === title && s.artist === artist);
  if (idx < 0) return res.status(404).json({ error: 'song not in queue' });

  // Record skip of current song if any, and push to history
  if (now && now.title !== title) {
    recordPlay({
      title: now.title,
      artist: now.artist,
      duration_sec: 0,
      played_sec: 0,
      ended_reason: 'user_skip',
    });
    playHistory.push(now);
    if (playHistory.length > 30) playHistory.shift();
  }

  now = currentQueue[idx];
  broadcast({ type: 'now', data: now });
  res.json({ ok: true, now });
});

// POST /api/previous — go back to last track in history
app.post('/api/previous', (req, res) => {
  if (playHistory.length === 0) {
    return res.json({ ok: false, reason: 'no_history' });
  }
  now = playHistory.pop();
  broadcast({ type: 'now', data: now });
  res.json({ ok: true, now });
});

// GET /api/state/* — transparency endpoints for slash commands
app.get('/api/state/anti', (req, res) => res.json(antiList()));
app.get('/api/state/cooldown', (req, res) => res.json(activeCooldowns()));
app.get('/api/state/history', (req, res) => res.json(recentChatTurns(10)));
app.get('/api/state/stats', (req, res) => res.json(feedbackStats()));

server.listen(PORT, config.server.host, async () => {
  console.log(`NightlinerFM server on http://${config.server.host}:${PORT}`);

  console.log('[startup] warming up BGE-M3...');
  await warmup();
  console.log('[startup] BGE-M3 ready');

  console.log('[startup] incremental index...');
  const t0 = Date.now();
  const s = await indexAllSongs();
  const fb = await indexAllFeedback();
  const ct = await indexAllChatTurns();
  const mdTargets = [
    ['user/taste.md', 'taste'],
    ['user/life-stages.md', 'life_stage'],
    ['user/mood-rules.md', 'mood_rule'],
    ['user/dj-persona.md', 'persona'],
    ['user/vibe-anchors.md', 'vibe_anchor'],
  ];
  for (const [p, t] of mdTargets) await indexMdFile(p, t);
  console.log(`[startup] index done in ${((Date.now() - t0) / 1000).toFixed(1)}s (songs +${s.added}, fb +${fb.added}, turns +${ct.added})`);
});
