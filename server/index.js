// server/index.js
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import yaml from 'yaml';
import fs from 'fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildChatMessages, libraryArtistNames } from './context-builder.js';
import { repairFamiliarNew } from './align-batch.js';
import { carriesDirection, describeDirection, detectVerbatim, isAcknowledgment, detectPinnedFirst, detectAppendRequest, resolveDirectionStateWithArtistAliases } from './direction.js';
import { callLlmStream } from './llm-adapter.js';
import { makeArtistAliasResolver } from './artist-resolver.js';
import { resolvePlayList, resolveById } from './playback-coordinator.js';
import { recordFeedback, recordPlay, recordQueue, recordChatTurn, recentChatTurns, recentPlays, antiList, activeCooldowns, feedbackStats } from './state-db.js';
import { recommendSongs, personalFm, cloudsearch, searchArtists, artistTopSongs } from './ncm-client.js';
import { warmup } from './embedder.js';
import { indexAllSongs, indexAllFeedback, indexAllChatTurns, indexMdFile } from './indexer.js';
import { checkReasonHallucination } from './budget-enforcer.js';
import { normalizeSearchSongs, normalizeSearchArtists, normalizeArtistSongs } from './search-normalize.js';
import { playNow, enqueue, clearUpcoming, removeFromQueue, sameSong, applyChatRecommendation, arrangeQueue, decideQueueAction } from './queue-ops.js';
import { buildPlaylist, plKey } from './playlist-builder.js';
import { buildExplorePool, songKey } from './explore-pool.js';
import { songAffinity, artistAffinity, songWeight, lovedSeeds, graduatedLibrary, negativeSongs } from './affinity.js';
import { normalizePlayItems } from './chat-guards.js';

const config = yaml.parse(await fs.readFile('config.yaml', 'utf8'));
const PORT = process.env.PORT || config.server.port; // PORT 环境变量可覆盖(开发/preview 用)
const AUTH_TOKEN = process.env.AUTH_TOKEN; // 设了才启用访问鉴权(公网部署设;本地开发不设→放行)
const resolveArtistAlias = makeArtistAliasResolver({ model: config.models.light_command || config.models.chat_mode });

const app = express();
app.use(express.json());

// CORS:拆开部署时前端在别的域名(如 Vercel),浏览器跨域请求需放行。
// 浏览器请求不带凭证(网易云 cookie 是服务端自用),用 * 即可;OPTIONS 预检直接 204。
// 同源自托管时此头无害。要收紧可把 * 换成具体的前端域名。
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 访问鉴权:设了 AUTH_TOKEN 才校验。前端密码门把口令作为 Bearer 带在每个 /api 请求上。
// OPTIONS 预检上面已 204 返回,不会到这;静态前端不设防(无敏感内容,且 Vercel 模式下不经此托管)。
if (AUTH_TOKEN) {
  app.use('/api', (req, res, next) => {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== AUTH_TOKEN) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
}

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
  const add = (s, src) => {
    if (!s || s.id == null || !s.name) return;
    if (byId.has(s.id)) return;
    byId.set(s.id, {
      name: s.name,
      artist: (s.ar || s.artists || []).map(a => a.name).join(' / '),
      ncm_id: s.id,
      pic_url: s.al?.picUrl || s.album?.picUrl || null,  // DAILY 整版页要封面;DJ prompt 只取 name/artist 不受影响
      src,                                               // 'daily' | 'fm':/api/recommend 只取 daily
    });
  };
  try {
    const data = await recommendSongs(30);
    for (const s of (data?.data?.dailySongs || [])) add(s, 'daily');
    // 叠加 personal_fm:每次返回不同的几首 → 给推荐池注入会轮换的新鲜血液(抓两次拿更多)
    const fmResults = await Promise.allSettled([personalFm(), personalFm()]);
    for (const r of fmResults) {
      if (r.status === 'fulfilled') for (const s of (r.value?.data || [])) add(s, 'fm');
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

// Library pool for Listen 歌单:收藏快照里带 ncm_id 的歌(按 id 去重),缓存一次。
let _libraryPool = null;
async function getLibraryPool() {
  if (_libraryPool) return _libraryPool;
  try {
    const raw = JSON.parse(await fs.readFile('data/netease-snapshot.json', 'utf8'));
    const byId = new Map();
    for (const pl of Object.values(raw.playlists)) {
      for (const song of pl.songs) {
        if (song.id == null || byId.has(song.id)) continue;
        byId.set(song.id, { ncm_id: song.id, name: song.name, artist: song.artists });
      }
    }
    _libraryPool = [...byId.values()];
  } catch {
    _libraryPool = [];
  }
  return _libraryPool;
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

wss.on('connection', (ws, req) => {
  if (AUTH_TOKEN) {
    const token = new URL(req.url, 'http://x').searchParams.get('token');
    if (token !== AUTH_TOKEN) { ws.close(4001, 'unauthorized'); return; } // 前端收到 4001 → 弹密码门
  }
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

// 正在生成的本轮 DJ 回复(单用户 → 至多一轮在飞)。stop 端点据此中断 LLM 流。
let currentChat = null;

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.json({ ok: true, status: 'thinking' });
  broadcast({ type: 'thinking', data: true });

  // 本轮的中止句柄:/api/chat/stop 调 ac.abort() 会让下游 DeepSeek fetch 抛 AbortError
  const ac = new AbortController();
  currentChat = { ac };

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
    // 纯确认词不进 LLM:保留当前 direction/queue,只记录一轮 chat。
    if (isAcknowledgment(message)) {
      const say = '嗯。';
      broadcast({ type: 'dj_stream_start', data: { id: streamId, ts } });
      broadcast({ type: 'thinking', data: false });
      broadcast({ type: 'dj_stream_delta', data: { id: streamId, delta: say } });
      broadcast({ type: 'dj_stream_end', data: { id: streamId, say } });
      console.log('[chat] 纯确认词 → LLM 前置短路为 chat');
      recordChatTurn({
        user_message: message,
        intent: 'chat',
        dj_say: say,
        play_titles_json: JSON.stringify([]),
        queue_action: null,
        feedback_extract_json: null,
        context_now_title: now?.title || null,
        context_now_artist: now?.artist || null,
      });
      return;
    }

    // 方向解析:server 拥有最终方向状态。续批/纠错里的 partial direction 与上一轮做 base ∩ new。
    const previousDirection = currentDirection;
    currentDirection = await resolveDirectionStateWithArtistAliases(currentDirection, message, {
      artistNames: await libraryArtistNames(),
      resolveArtistAlias,
    });
    if (currentDirection) {
      const carried = previousDirection && carriesDirection(message) ? ' (合并/沿用上轮)' : '';
      console.log(`[chat] 方向=${describeDirection(currentDirection)}${carried}`);
    }

    const verbatim = detectVerbatim(message); // 「直接放每日推荐」/「第一首放 X」→ 跳过比例换槽
    if (verbatim) console.log('[chat] verbatim 指令 → 跳过 familiar/new 换槽,保住模型选曲与顺序');
    const pinnedFirst = detectPinnedFirst(message);
    if (pinnedFirst) console.log('[chat] pinnedFirst 指令 → 保护 play[0],其余按档位对齐');

    const recommendPoolP = getRecommendPool(); // 与 RAG 检索并行,buildChatMessages 内部 await
    const { system, messages, meta } = await buildChatMessages({
      userMessage: message,
      currentQueue,
      n: tuning.queue_length,
      exploration_pct: tuning.exploration_pct,
      recommendPool: recommendPoolP,
      now,
      direction: currentDirection,
      verbatim,
      pinnedFirst,
    });

    const { say: parsedSay, parsed, status } = await callLlmStream({
      system, messages, model: config.models.chat_mode, trigger: 'chat', onSayDelta, signal: ac.signal,
    });

    // status=failed → 容错修复 + json_object 重问都没救回来。别再静默当 chat 丢弃(那会污染
    // chat_turns 记忆,让下一轮以为"用户只是闲聊"),如实标记 parse_error。
    let intent = status === 'failed' ? 'parse_error' : (parsed.intent || 'recommend');
    // Layer 3:整句只是确认词("好的"/"嗯")→ 强制当 chat,绝不因 default-recommend 或模型手滑
    // 而重新推荐(历史 bug:"好的" 被当 recommend、把方向内仅有的 바빠 又推一遍)。
    if (intent !== 'parse_error' && isAcknowledgment(message)) {
      if (intent === 'recommend') console.log('[chat] 纯确认词 → 覆盖 intent=chat,不重新推荐');
      intent = 'chat';
    }
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
    let recordedQueueAction = null;

    if (intent === 'parse_error') {
      // 修复 + 重问都失败:不执行任何队列动作,如实告诉用户而不是装作聊了天
      broadcast({ type: 'dj_message', data: { ts, kind: 'system',
        text: '抱歉,刚没接住你的意思(回复没解析成功)——再说一次?' } });
      console.warn('[chat] parse_error: JSON 修复+json_object 重问均失败,本轮未执行');

    } else if (intent === 'recommend') {
      // Resolve play list → NCM URLs. Missing title/artist is malformed output;
      // reason/source_pool are normalized by chat-guards because playback does not depend on them.
      const rawPlays = Array.isArray(parsed.play) ? parsed.play : [];
      const normalized = normalizePlayItems(rawPlays);
      const plays = normalized.plays;
      parsed.play = plays;
      if (normalized.dropped) {
        console.warn(`[chat] dropped ${normalized.dropped}/${rawPlays.length} malformed play items before resolve`);
      }

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
      let playable = resolved.filter(s => s.found);

      // 显式点名的第一首没解析出来(常是网易云瞬时 502)→ 先重试一次同样的解析路径,
      // 仍失败才提示用户(别静默丢)。重试成功就放回队首。
      if (pinnedFirst && plays.length) {
        const want = plays[0];
        if (!playable.some(s => s.title === want.title)) {
          const retry = await resolvePlayList([want]).catch(() => []);
          const got = retry.find(s => s.found);
          if (got) {
            playable = [got, ...playable];
            console.log(`[chat] pinnedFirst "${want.title}" 重试解析成功,放回队首`);
          } else {
            broadcast({ type: 'dj_message', data: { ts, kind: 'system',
              text: `「${want.title}」这次没找到能播的版本(可能网络抖动),其余照常。` } });
            console.warn(`[chat] pinnedFirst "${want.title}" 重试后仍未解析,已提示用户`);
          }
        }
      }
      const arranged = arrangeQueue(playable, { pinnedFirst, verbatim });

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
      // F4:不信模型自报的 queueAction(它会随手用 insert_next 把新批追加到旧队列后面 →
      // 队列滚雪球、和调音台长度对不上)。服务端按请求类型确定性决定:显式「再加」才追加,
      // 否则换批(有 now → rewrite_tail 保住在播那首、换掉待播;无 now → replace_all)。
      const queueAction = decideQueueAction({ append: detectAppendRequest(message), hasNow: !!now });
      recordedQueueAction = queueAction;
      const overrode = parsed.queueAction && parsed.queueAction !== queueAction ? `(模型自报 ${parsed.queueAction} → 覆盖)` : '';
      console.log(`[chat] queueAction=${queueAction}${overrode}, library_hits=${library_hits}/${plays.length}`);

      const applied = applyChatRecommendation(currentQueue, now, arranged, queueAction);
      currentQueue = applied.queue;
      now = applied.now;

      if (applied.changed) {
        recordQueue({ mode: 'chat', songs: currentQueue });
        broadcast({ type: 'queue', data: currentQueue });
        broadcast({ type: 'now', data: now });

        // DJ opening 已通过 dj_stream_* 流式给到前端,这里不再重复广播
        // names-only:逐首只报歌名,不显示每首描述。reason 仍留在 queue 数据 / chat_turns 里
        // 供记忆与幻觉校验,只是不展示。想恢复「每首带描述」时把 text 改回 arranged[i].reason 即可。
        for (let i = 0; i < arranged.length; i++) {
          broadcast({ type: 'dj_message', data: { ts, kind: 'song', title: arranged[i].title, text: '' } });
        }
      } else {
        // 护栏:playable 为空 → queue 已保住不变,如实告知而不是静默清空播放
        broadcast({ type: 'dj_message', data: { ts, kind: 'system',
          text: '这批没找到能播的歌(可能都无版权或解析失败),队列保持不变。' } });
        console.warn(`[chat] recommend 解析出 ${plays.length} 首但 0 首可播,队列未改动`);
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
      queue_action: recordedQueueAction || null,
      feedback_extract_json: recordedFeedback ? JSON.stringify(recordedFeedback) : null,
      context_now_title: now?.title || null,
      context_now_artist: now?.artist || null,
    });

  } catch (e) {
    if (ac.signal.aborted) {
      // 用户手动停止本轮:不是错误。中断 LLM,不提交任何队列/反馈/记忆(本轮等于没发生)。
      // 只把流式气泡收尾(带 stopped 标记),保留已经吐出的半句话。
      broadcast({ type: 'thinking', data: false });
      if (streamStarted) broadcast({ type: 'dj_stream_end', data: { id: streamId, say: streamedSay.trim(), stopped: true } });
      console.log('[chat] 用户停止本轮生成 → 未提交任何动作');
    } else {
      console.error('chat error:', e);
      broadcast({ type: 'thinking', data: false });
      // 若已开了流式气泡,先收尾,避免前端留一个永远在打字的空泡
      if (streamStarted) broadcast({ type: 'dj_stream_end', data: { id: streamId, say: streamedSay.trim() } });
      broadcast({ type: 'dj_message', data: { ts: new Date().toISOString(), kind: 'system', text: '出错了:' + e.message } });
    }
  } finally {
    currentChat = null;
  }
});

// POST /api/chat/stop — 手动中止正在生成的本轮 DJ 回复(中断 LLM 流,不提交队列/反馈/记忆)
app.post('/api/chat/stop', (req, res) => {
  if (currentChat) {
    currentChat.ac.abort();
    console.log('[chat] 收到停止请求 → 中断本轮生成');
    return res.json({ ok: true, stopped: true });
  }
  res.json({ ok: true, stopped: false });
});

// GET /api/now
app.get('/api/now', (req, res) => res.json(now));

// GET /api/queue
app.get('/api/queue', (req, res) => res.json(currentQueue));

// POST /api/queue/clear — 清空待播队列(正在播的歌不动)
app.post('/api/queue/clear', (req, res) => {
  currentQueue = clearUpcoming(currentQueue, now).queue;
  recordQueue({ mode: 'manual', songs: currentQueue });
  broadcast({ type: 'queue', data: currentQueue });
  res.json({ ok: true, queue: currentQueue });
});

// POST /api/queue/remove — 从待播队列移除指定歌(正在播的不可移除)
app.post('/api/queue/remove', (req, res) => {
  const { ncm_id, title, artist } = req.body;
  if (ncm_id == null && (!title || !artist)) return res.status(400).json({ error: 'ncm_id or title+artist required' });
  const target = { ncm_id, title, artist };
  if (now && sameSong(target, now)) return res.status(409).json({ error: 'cannot remove now-playing' });
  const before = currentQueue.length;
  currentQueue = removeFromQueue(currentQueue, now, target).queue;
  if (currentQueue.length === before) return res.status(404).json({ error: 'song not in queue' });
  recordQueue({ mode: 'manual', songs: currentQueue });
  broadcast({ type: 'queue', data: currentQueue });
  res.json({ ok: true, queue: currentQueue });
});

// POST /api/feedback
app.post('/api/feedback', (req, res) => {
  const { title, artist, signal, reason, ncm_id } = req.body;
  if (!title || !artist || !signal) return res.status(400).json({ error: 'fields missing' });
  recordFeedback({
    song_title: title,
    song_artist: artist,
    signal,
    ncm_id: ncm_id ?? null,
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

// POST /api/resolve — 凭 ncm_id 重新解析一条新鲜直链。
// 网易云直链 ~20min(expi:1200)过期:播放层在 <audio> 报错/长卡顿时调它续播,
// 不在 skip/advance 时预解析(避免给每次切歌都加一次网络往返)。
app.post('/api/resolve', async (req, res) => {
  const { ncm_id, title, artist } = req.body;
  if (ncm_id == null) return res.status(400).json({ error: 'ncm_id required' });
  try {
    const resolved = await resolveById({ ncm_id, title, artist });
    res.json(resolved);   // { found, url?, reason?('unplayable'|'error'), ... }
  } catch (e) {
    console.error('[resolve] error:', e);
    res.status(500).json({ found: false, reason: 'error' });
  }
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

// ---- 手动浏览/点播(DAILY / SEARCH 整版页)----

// GET /api/recommend — 今日每日推荐(带封面)。池子是 daily+fm 混合,这里只取 daily;
// daily 拉不到(cookie 过期等)时退回整池,聊胜于无。
app.get('/api/recommend', async (req, res) => {
  const pool = await getRecommendPool();
  const daily = pool.filter(s => s.src === 'daily');
  res.json({ songs: daily.length ? daily : pool });
});

// GET /api/search?q=&type=song|artist&limit=20
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const type = req.query.type === 'artist' ? 'artist' : 'song';
  const limit = Math.min(Number(req.query.limit) || 20, 30);
  if (!q) return res.json(type === 'artist' ? { artists: [] } : { songs: [] });
  try {
    if (type === 'artist') {
      const r = await searchArtists(q, { limit });
      return res.json({ artists: normalizeSearchArtists(r) });
    }
    const r = await cloudsearch(q, { limit });
    res.json({ songs: normalizeSearchSongs(r) });
  } catch (e) {
    console.warn('[search] failed:', e.message);
    res.status(502).json({ error: 'search_failed' });
  }
});

// GET /api/artist/songs?id= — 某歌手热门曲
app.get('/api/artist/songs', async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const r = await artistTopSongs(id);
    res.json({ songs: normalizeArtistSongs(r) });
  } catch (e) {
    console.warn('[artist/songs] failed:', e.message);
    res.status(502).json({ error: 'artist_songs_failed' });
  }
});

// POST /api/play — 手动点播 { title, artist, ncm_id?, mode: 'now'|'queue' }
// 不校验 anti/cooldown:用户明确点了就尊重。play-event 仍由前端 audio 照常上报。
app.post('/api/play', async (req, res) => {
  const { title, artist, ncm_id, mode } = req.body;
  if (!title && ncm_id == null) return res.status(400).json({ error: 'title or ncm_id required' });
  try {
    const resolved = ncm_id != null
      ? await resolveById({ ncm_id, title, artist })
      : (await resolvePlayList([{ title, artist }]))[0];

    if (!resolved?.found) {
      return res.json({ ok: false, reason: resolved?.reason || 'not_found' });
    }

    if (mode === 'queue') {
      const r = enqueue(currentQueue, now, resolved);
      currentQueue = r.queue; now = r.now;
    } else {
      const r = playNow(currentQueue, now, resolved);
      currentQueue = r.queue; now = r.now;
    }
    recordQueue({ mode: 'manual', songs: currentQueue });
    broadcast({ type: 'queue', data: currentQueue });
    broadcast({ type: 'now', data: now });
    res.json({ ok: true, song: resolved });
  } catch (e) {
    console.error('[play] error:', e);
    res.status(500).json({ ok: false, reason: 'error' });
  }
});

// POST /api/listen — 「点即播」歌单 { level, n? }
// daily = 每日推荐池 daily 切片;5 档 = buildPlaylist 按配方从三池确定性随机抽样。
// 生成 → resolveById 并行解析(按 ncm_id 直取)→ 整批替换 queue 并从首歌开播。
// 排除 anti-list(永久禁播)+ 最近播放;不动全局调音台档位。
const LEVEL_VALUE = { comfort: 0, cozy: 25, balanced: 50, venture: 75, wild: 100 };
app.post('/api/listen', async (req, res) => {
  const level = String(req.body.level || '').toLowerCase();
  const n = Math.min(Number(req.body.n) || 25, 40);
  try {
    let songs;
    if (level === 'daily') {
      const pool = await getRecommendPool();
      const daily = pool.filter(s => s.src === 'daily');
      songs = [...(daily.length ? daily : pool)].sort(() => Math.random() - 0.5).slice(0, n);
    } else if (level in LEVEL_VALUE) {
      const [library, recommend] = await Promise.all([getLibraryPool(), getRecommendPool()]);
      // graduate loved discoveries into the familiar pool (augment, don't replace)
      const libKeySet = new Set(library.map(s => songKey(s.name, s.artist)));
      const fullLibrary = [...library, ...graduatedLibrary(libKeySet)];
      // seed exploration from what Elliot LOVES (fallback to random library on cold start)
      const seeds = lovedSeeds(5).length
        ? lovedSeeds(5)
        : [...library].sort(() => Math.random() - 0.5).slice(0, 5)
            .map(s => ({ ncm_id: s.ncm_id, name: s.name, artist: s.artist }));
      const wildcard = await buildExplorePool({ seeds, perSeedCap: 3, limit: 40 }).catch(() => []);
      const excludeKeys = new Set();
      for (const a of antiList()) excludeKeys.add(plKey({ name: a.song_title, artist: a.song_artist }));
      for (const p of recentPlays(20)) excludeKeys.add(plKey({ name: p.title, artist: p.artist }));
      for (const nv of negativeSongs()) excludeKeys.add(plKey({ name: nv.song_title, artist: nv.song_artist })); // wrong_vibe + cooldown
      const songAff = songAffinity(), artistAff = artistAffinity();
      const weightOf = (s) => songWeight(s, { songAff, artistAff });
      songs = buildPlaylist({ value: LEVEL_VALUE[level], n, pools: { library: fullLibrary, recommend, wildcard }, excludeKeys, weightOf });
    } else {
      return res.status(400).json({ ok: false, reason: 'bad_level' });
    }

    if (!songs.length) return res.json({ ok: false, reason: 'empty' });

    const resolved = await Promise.all(
      songs.map(s => resolveById({ ncm_id: s.ncm_id, title: s.name, artist: s.artist }))
    );
    const playable = resolved.filter(s => s.found);
    if (!playable.length) return res.json({ ok: false, reason: 'unplayable' });

    currentQueue = playable;
    now = playable[0];
    recordQueue({ mode: `listen:${level}`, songs: currentQueue });
    broadcast({ type: 'queue', data: currentQueue });
    broadcast({ type: 'now', data: now });
    console.log(`[listen] ${level} → ${playable.length}/${songs.length} playable`);
    res.json({ ok: true, level, count: playable.length });
  } catch (e) {
    console.error('[listen] error:', e);
    res.status(500).json({ ok: false, reason: 'error' });
  }
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
    ['user/dj-persona.md', 'persona'],
    ['user/vibe-anchors.md', 'vibe_anchor'],
  ];
  for (const [p, t] of mdTargets) await indexMdFile(p, t);
  console.log(`[startup] index done in ${((Date.now() - t0) / 1000).toFixed(1)}s (songs +${s.added}, fb +${fb.added}, turns +${ct.added})`);
});
