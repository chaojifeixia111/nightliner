// server/index.js
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import yaml from 'yaml';
import fs from 'fs/promises';
import { buildChatPrompt } from './context-builder.js';
import { callLlm, extractJson } from './llm-adapter.js';
import { resolvePlayList } from './playback-coordinator.js';
import { recordFeedback, recordPlay, recordQueue, recordChatTurn, recentChatTurns, antiList, activeCooldowns, feedbackStats } from './state-db.js';
import { recommendSongs, personalFm } from './ncm-client.js';

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

// Play history stack for ⏮ previous track (max 30 entries)
let playHistory = [];

// In-memory tuning state
let tuning = {
  exploration_pct: 30,
  queue_length: 10,
  chattiness: 'medium',
};

// Recommend pool cache (refreshed every 30 min)
let recommendCache = { ts: 0, songs: [] };

async function getRecommendPool() {
  const THIRTY_MIN = 30 * 60 * 1000;
  if (Date.now() - recommendCache.ts < THIRTY_MIN && recommendCache.songs.length) {
    return recommendCache.songs;
  }
  try {
    const data = await recommendSongs(20);
    const songs = (data?.data?.dailySongs || []).map(s => ({
      name: s.name,
      artist: (s.ar || []).map(a => a.name).join(' / '),
    }));
    if (songs.length) {
      recommendCache = { ts: Date.now(), songs };
      console.log(`[recommend] pool refreshed: ${songs.length} songs`);
    } else {
      // fallback to personal FM
      const fm = await personalFm();
      const fmSongs = (fm?.data || []).map(s => ({
        name: s.name,
        artist: (s.ar || s.artists || []).map(a => a.name).join(' / '),
      }));
      recommendCache = { ts: Date.now(), songs: fmSongs };
      console.log(`[recommend] pool from personalFm: ${fmSongs.length} songs`);
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
  const { exploration_pct, queue_length, chattiness } = req.body;
  if (exploration_pct !== undefined) tuning.exploration_pct = Number(exploration_pct);
  if (queue_length !== undefined) tuning.queue_length = Number(queue_length);
  if (chattiness !== undefined) tuning.chattiness = chattiness;
  broadcast({ type: 'tuning', data: tuning });
  res.json({ ok: true, tuning });
});

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.json({ ok: true, status: 'thinking' });
  broadcast({ type: 'thinking', data: true });

  try {
    const recommendPool = await getRecommendPool();
    const prompt = await buildChatPrompt({
      userMessage: message,
      currentQueue,
      n: tuning.queue_length,
      exploration_pct: tuning.exploration_pct,
      recommendPool,
    });
    const raw = await callLlm({ prompt, model: config.models.chat_mode, trigger: 'chat' });
    const parsed = extractJson(raw);

    const intent = parsed.intent || 'recommend';
    console.log(`[chat] intent=${intent}, say="${(parsed.say || '').slice(0, 40)}..."`);

    // Memory tracking
    let recordedPlayTitles = [];
    let recordedFeedback = null;

    const ts = new Date().toISOString();

    if (intent === 'recommend') {
      // Resolve play list → NCM URLs
      const plays = Array.isArray(parsed.play) ? parsed.play : [];
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

      // DJ opening
      broadcast({ type: 'dj_message', data: { ts, kind: 'opening', text: parsed.say } });
      // Per-song reasons
      for (let i = 0; i < playable.length; i++) {
        const s = playable[i];
        const reason = plays[i]?.reason || '';
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

        // Broadcast say (DJ acknowledgment)
        broadcast({ type: 'dj_message', data: { ts, kind: 'opening', text: parsed.say } });

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
      // intent === 'chat': just broadcast say, no queue change
      broadcast({ type: 'dj_message', data: { ts, kind: 'chat_reply', text: parsed.say } });
    }

    broadcast({ type: 'thinking', data: false });

    // Always record the turn for persistent memory
    recordChatTurn({
      user_message: message,
      intent,
      dj_say: parsed.say,
      play_titles_json: JSON.stringify(recordedPlayTitles),
      queue_action: parsed.queueAction || null,
      feedback_extract_json: recordedFeedback ? JSON.stringify(recordedFeedback) : null,
      context_now_title: now?.title || null,
      context_now_artist: now?.artist || null,
    });

  } catch (e) {
    console.error('chat error:', e);
    broadcast({ type: 'thinking', data: false });
    broadcast({ type: 'dj_message', data: { ts: new Date().toISOString(), kind: 'opening', text: '出错了:' + e.message } });
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

server.listen(PORT, config.server.host, () => {
  console.log(`NightlinerFM server on http://${config.server.host}:${PORT}`);
});
