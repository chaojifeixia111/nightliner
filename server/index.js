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

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'now', data: now }));
  ws.send(JSON.stringify({ type: 'queue', data: currentQueue }));
});

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.json({ ok: true, status: 'thinking' });
  broadcast({ type: 'subtitle', data: 'DJ 思考中...' });

  try {
    const prompt = await buildChatPrompt({ userMessage: message, currentQueue, n: 5 });
    const raw = await callClaude({ prompt, model: config.models.chat_mode, trigger: 'chat' });
    const parsed = extractJson(raw);

    const resolved = await resolvePlayList(parsed.play);
    const playable = resolved.filter(s => s.found);

    if (parsed.queueAction === 'rewrite_tail' && currentQueue.length) {
      // 保留当前已播,替换后段
      const idxNow = now ? currentQueue.findIndex(s => s.title === now.title) : -1;
      const head = idxNow >= 0 ? currentQueue.slice(0, idxNow + 1) : [];
      currentQueue = [...head, ...playable];
    } else if (parsed.queueAction === 'insert_next') {
      const idxNow = now ? currentQueue.findIndex(s => s.title === now.title) : -1;
      currentQueue.splice(idxNow + 1, 0, ...playable);
    } else {
      // null / 'replace_all' → 直接整批替换(M7-mini 简化:不区分 replace_all 和默认)
      currentQueue = playable;
      now = playable[0] || null;
    }

    recordQueue({ mode: 'chat', songs: currentQueue });
    broadcast({ type: 'queue', data: currentQueue });
    broadcast({ type: 'now', data: now });
    broadcast({ type: 'subtitle', data: parsed.say + (parsed.play[0]?.reason ? '\n' + parsed.play[0].reason : '') });
  } catch (e) {
    console.error('chat error:', e);
    broadcast({ type: 'subtitle', data: '出错了:' + e.message });
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
  // 反馈影响下一段 queue 在下一次 chat 时通过 prompt 注入生效
});

// POST /api/play-event(由 PWA 在 audio 事件时上报)
app.post('/api/play-event', (req, res) => {
  const e = req.body;
  recordPlay({
    title: e.title,
    artist: e.artist,
    duration_sec: e.duration_sec,
    played_sec: e.played_sec,
    ended_reason: e.ended_reason,
  });
  // 切到下一首
  if (e.ended_reason === 'natural' || e.ended_reason === 'user_skip') {
    const idx = currentQueue.findIndex(s => s.title === e.title);
    if (idx >= 0 && idx + 1 < currentQueue.length) {
      now = currentQueue[idx + 1];
      broadcast({ type: 'now', data: now });
    } else {
      now = null;
      broadcast({ type: 'now', data: null });
      broadcast({ type: 'subtitle', data: 'queue 结束。再来一段?' });
    }
  }
  res.json({ ok: true });
});

server.listen(PORT, config.server.host, () => {
  console.log(`Nightliner server on http://${config.server.host}:${PORT}`);
});
