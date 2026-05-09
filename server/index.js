// server/index.js
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import yaml from 'yaml';
import fs from 'fs/promises';
import { buildChatPrompt } from './context-builder.js';
import { callClaude, extractJson } from './claude-adapter.js';
import { resolvePlayList } from './playback-coordinator.js';
import { recordFeedback, recordPlay, recordQueue } from './state-db.js';

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

// In-memory tuning state
let tuning = {
  exploration_pct: 30,
  queue_length: 5,
  chattiness: 'medium',
};

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
    const prompt = await buildChatPrompt({
      userMessage: message,
      currentQueue,
      n: tuning.queue_length,
      exploration_pct: tuning.exploration_pct,
    });
    const raw = await callClaude({ prompt, model: config.models.chat_mode, trigger: 'chat' });
    const parsed = extractJson(raw);

    const resolved = await resolvePlayList(parsed.play);
    const playable = resolved.filter(s => s.found);

    if (parsed.queueAction === 'rewrite_tail' && currentQueue.length) {
      const idxNow = now ? currentQueue.findIndex(s => s.title === now.title) : -1;
      const head = idxNow >= 0 ? currentQueue.slice(0, idxNow + 1) : [];
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
    broadcast({ type: 'thinking', data: false });

    // Broadcast DJ messages (opening + per-song reasons)
    const ts = new Date().toISOString();
    broadcast({ type: 'dj_message', data: { ts, kind: 'opening', text: parsed.say } });
    for (let i = 0; i < playable.length; i++) {
      const s = playable[i];
      const reason = parsed.play?.[i]?.reason || '';
      if (reason) {
        broadcast({ type: 'dj_message', data: { ts, kind: 'song', title: s.title, text: reason } });
      }
    }

    // Compute and broadcast stats
    const snapshotNorm = await getSnapshotNorm();
    let library_hits = 0;
    let recommend = 0;
    let wildcard = 0;
    for (let i = 0; i < parsed.play?.length; i++) {
      const sp = parsed.play[i]?.source_pool || '';
      if (sp === 'library') library_hits++;
      else if (sp === 'recommend') recommend++;
      else wildcard++;
    }
    const vip_skipped = resolved.filter(s => !s.found && s.ncm_id).length;
    const not_found = resolved.filter(s => !s.found && !s.ncm_id).length;
    broadcast({
      type: 'stats',
      data: {
        library_hits,
        recommend,
        wildcard,
        vip_skipped,
        not_found,
        total: parsed.play?.length || 0,
      },
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
  const { title, artist, signal } = req.body;
  if (!title || !artist || !signal) return res.status(400).json({ error: 'fields missing' });
  recordFeedback({ song_title: title, song_artist: artist, signal });
  res.json({ ok: true });
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

  // Record skip of current song if any
  if (now && now.title !== title) {
    recordPlay({
      title: now.title,
      artist: now.artist,
      duration_sec: 0,
      played_sec: 0,
      ended_reason: 'user_skip',
    });
  }

  now = currentQueue[idx];
  broadcast({ type: 'now', data: now });
  res.json({ ok: true, now });
});

server.listen(PORT, config.server.host, () => {
  console.log(`Nightliner server on http://${config.server.host}:${PORT}`);
});
