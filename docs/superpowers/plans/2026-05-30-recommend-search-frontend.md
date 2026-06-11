# 每日推荐 + 搜索 前端入口 Implementation Plan

> **状态(2026-06-12)**:已规划、**未实现**。所有 task 均未开始;实现前先对照 nightliner-design-v0.5.md 核对接口现状。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 NightlinerFM 加两个顶栏入口——网易云「每日推荐」浏览 + 歌曲/歌手「搜索」——点歌即播、⊕ 加队列,复用现有播放链路。

**Architecture:** 后端把已有的 NCM 能力暴露成 4 个接口(recommend / search / artist-songs / play),纯逻辑(结果归一化、队列变更)抽成可单测的小模块;前端加两个右滑抽屉(复用 `QueueDrawer` 模式)+ 两个共用行组件,抽屉自包含调接口,播放经 ws 广播 `now`/`queue` 驱动现有 `<audio>`。

**Tech Stack:** Node + Express + ws(后端);Vue 3 + Vite(PWA);`node:test`(后端单测);NeteaseCloudMusicApi(127.0.0.1:3000)。

**关联 spec:** `docs/superpowers/specs/2026-05-30-recommend-search-frontend-design.md`

**约定:**
- 在独立分支/worktree 上执行(由 using-git-worktrees 在执行期创建)。
- 每个 commit message 末尾加一行:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`(下方示例省略)。
- 后端单测命令:`node --env-file=.env --test --test-concurrency=1 "tests/**/*.test.js"`(单文件:`node --test tests/<file>.test.js`)。
- 前端可视验证前置:NCM API(`scripts/start-ncm-api.ps1`)、`data/netease-cookie.txt` 有效、`node --env-file=.env server/index.js` 已起、`cd pwa && npm run dev` 开 vite(:5173 代理 /api、/stream 到 :8080)。

---

## 数据形状(贯穿全程,务必一致)

- **歌曲行 / song**:`{ ncm_id, name, artist, pic_url }`(recommend、search song、artist songs 三处统一这个形状)
- **歌手行 / artist**:`{ artist_id, name, pic_url }`
- **已解析可播放项 / playable**(进 `currentQueue` / `now`):`{ title, artist, ncm_id, url, pic_url, duration_ms, ncm_name, ncm_artist, found }`
- 前端点歌 → `POST /api/play { title: song.name, artist: song.artist, ncm_id: song.ncm_id, mode }`

---

## Task 1: 结果归一化纯函数(TDD)

**Files:**
- Create: `server/search-normalize.js`
- Test: `tests/search-normalize.test.js`

- [ ] **Step 1: 写失败测试**

`tests/search-normalize.test.js`:
```js
// tests/search-normalize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDailySongs, normalizeSearchSongs, normalizeSearchArtists, normalizeArtistSongs,
} from '../server/search-normalize.js';

test('normalizeDailySongs: dailySongs → song 形状', () => {
  const data = { data: { dailySongs: [
    { id: 3, name: 'C', ar: [{ name: 'Y' }, { name: 'Z' }], al: { picUrl: 'p3' } },
  ] } };
  assert.deepEqual(normalizeDailySongs(data), [
    { ncm_id: 3, name: 'C', artist: 'Y / Z', pic_url: 'p3' },
  ]);
});

test('normalizeDailySongs: 空/缺字段 → []', () => {
  assert.deepEqual(normalizeDailySongs(null), []);
  assert.deepEqual(normalizeDailySongs({ data: {} }), []);
});

test('normalizeSearchSongs: cloudsearch songs(ar/al)', () => {
  const r = { result: { songs: [
    { id: 1, name: 'A', ar: [{ name: 'X' }], al: { picUrl: 'p' } },
  ] } };
  assert.deepEqual(normalizeSearchSongs(r), [
    { ncm_id: 1, name: 'A', artist: 'X', pic_url: 'p' },
  ]);
});

test('normalizeSearchSongs: 旧 artists/album 形状也兼容', () => {
  const r = { result: { songs: [
    { id: 2, name: 'B', artists: [{ name: 'W' }], album: { picUrl: 'q' } },
  ] } };
  assert.deepEqual(normalizeSearchSongs(r), [
    { ncm_id: 2, name: 'B', artist: 'W', pic_url: 'q' },
  ]);
});

test('normalizeSearchArtists: artists(picUrl 优先, 退 img1v1Url)', () => {
  const r = { result: { artists: [
    { id: 9, name: 'X', picUrl: 'pp' },
    { id: 10, name: 'Y', img1v1Url: 'qq' },
  ] } };
  assert.deepEqual(normalizeSearchArtists(r), [
    { artist_id: 9, name: 'X', pic_url: 'pp' },
    { artist_id: 10, name: 'Y', pic_url: 'qq' },
  ]);
});

test('normalizeArtistSongs: /artist/top/song songs', () => {
  const r = { songs: [{ id: 5, name: 'D', ar: [{ name: 'M' }], al: { picUrl: 'p5' } }] };
  assert.deepEqual(normalizeArtistSongs(r), [
    { ncm_id: 5, name: 'D', artist: 'M', pic_url: 'p5' },
  ]);
});

test('全部入口对空输入安全', () => {
  assert.deepEqual(normalizeSearchSongs(null), []);
  assert.deepEqual(normalizeSearchArtists(undefined), []);
  assert.deepEqual(normalizeArtistSongs({}), []);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/search-normalize.test.js`
Expected: FAIL —「Cannot find module '../server/search-normalize.js'」

- [ ] **Step 3: 实现**

`server/search-normalize.js`:
```js
// server/search-normalize.js
// 把 NCM 各接口返回的歌曲/歌手对象归一化成前端统一形状。纯函数,无副作用。

function artistsOf(s) {
  const arr = s.ar || s.artists || [];
  return arr.map(a => a?.name).filter(Boolean).join(' / ');
}
function picOf(s) {
  return s.al?.picUrl || s.album?.picUrl || null;
}
function toSong(s) {
  return { ncm_id: s.id, name: s.name, artist: artistsOf(s), pic_url: picOf(s) };
}

export function normalizeDailySongs(resp) {
  const songs = resp?.data?.dailySongs || [];
  return songs.map(toSong);
}
export function normalizeSearchSongs(resp) {
  const songs = resp?.result?.songs || [];
  return songs.map(toSong);
}
export function normalizeArtistSongs(resp) {
  const songs = resp?.songs || [];
  return songs.map(toSong);
}
export function normalizeSearchArtists(resp) {
  const artists = resp?.result?.artists || [];
  return artists.map(a => ({
    artist_id: a.id,
    name: a.name,
    pic_url: a.picUrl || a.img1v1Url || null,
  }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/search-normalize.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: commit**

```bash
git add server/search-normalize.js tests/search-normalize.test.js
git commit -m "feat(server): add NCM result normalization helpers"
```

---

## Task 2: 队列变更纯函数(TDD)

**Files:**
- Create: `server/queue-ops.js`
- Test: `tests/queue-ops.test.js`

- [ ] **Step 1: 写失败测试**

`tests/queue-ops.test.js`:
```js
// tests/queue-ops.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSong, playNow, enqueue } from '../server/queue-ops.js';

const s = (over) => ({ title: 't', artist: 'a', ncm_id: 1, url: 'u', ...over });

test('sameSong: 有 ncm_id 时按 id 比', () => {
  assert.equal(sameSong(s({ ncm_id: 1, title: 'X' }), s({ ncm_id: 1, title: 'Y' })), true);
  assert.equal(sameSong(s({ ncm_id: 1 }), s({ ncm_id: 2 })), false);
});
test('sameSong: 无 ncm_id 时按 title+artist', () => {
  assert.equal(sameSong({ title: 'T', artist: 'A' }, { title: 'T', artist: 'A' }), true);
  assert.equal(sameSong({ title: 'T', artist: 'A' }, { title: 'T', artist: 'B' }), false);
});

test('playNow: 空队列 → [song], now=song', () => {
  const r = playNow([], null, s({ ncm_id: 9 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [9]);
  assert.equal(r.now.ncm_id, 9);
});
test('playNow: 插在当前 now 之后, now=song', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const r = playNow(q, q[1], s({ ncm_id: 99 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 2, 99, 3]);
  assert.equal(r.now.ncm_id, 99);
});
test('playNow: now=null 但队列非空 → 插到队首', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  const r = playNow(q, null, s({ ncm_id: 99 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [99, 1, 2]);
  assert.equal(r.now.ncm_id, 99);
});
test('playNow: 不修改入参队列(纯函数)', () => {
  const q = [s({ ncm_id: 1 })];
  playNow(q, q[0], s({ ncm_id: 2 }));
  assert.equal(q.length, 1);
});

test('enqueue: 追加到末尾, now 不变', () => {
  const q = [s({ ncm_id: 1 })];
  const r = enqueue(q, q[0], s({ ncm_id: 2 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 2]);
  assert.equal(r.now.ncm_id, 1);
});
test('enqueue: now 为空时 → now=song(开始播)', () => {
  const r = enqueue([], null, s({ ncm_id: 7 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [7]);
  assert.equal(r.now.ncm_id, 7);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/queue-ops.test.js`
Expected: FAIL —「Cannot find module '../server/queue-ops.js'」

- [ ] **Step 3: 实现**

`server/queue-ops.js`:
```js
// server/queue-ops.js
// currentQueue / now 的纯变更逻辑。返回新数组,不改入参。song 是已解析的 playable。

export function sameSong(a, b) {
  if (!a || !b) return false;
  if (a.ncm_id != null && b.ncm_id != null) return a.ncm_id === b.ncm_id;
  return a.title === b.title && a.artist === b.artist;
}

// 立即播放:把 song 插到当前 now 之后并设为 now。now 不在队列(或为 null)时插到队首。
export function playNow(queue, now, song) {
  const idx = now ? queue.findIndex(x => sameSong(x, now)) : -1;
  const next = [...queue];
  next.splice(idx + 1, 0, song);   // idx=-1 → splice(0,0,...) 插到队首
  return { queue: next, now: song };
}

// 加入队列末尾。若当前没有 now,则这首立即成为 now。
export function enqueue(queue, now, song) {
  return { queue: [...queue, song], now: now || song };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/queue-ops.test.js`
Expected: PASS(8 tests)

- [ ] **Step 5: commit**

```bash
git add server/queue-ops.js tests/queue-ops.test.js
git commit -m "feat(server): add pure queue play-now/enqueue ops"
```

---

## Task 3: NCM 客户端歌手接口 + 按 id 解析直链

**Files:**
- Modify: `server/ncm-client.js`(文件末尾,`personalFm` 之后)
- Modify: `server/playback-coordinator.js`(`resolvePlayList` 之前/之后加 `resolveById`)

- [ ] **Step 1: ncm-client 加歌手两接口**

在 `server/ncm-client.js` 末尾追加:
```js
// 歌手搜索(cloudsearch type=100 → result.artists)
export async function searchArtists(keywords, { limit = 20 } = {}) {
  return ncmRequest('/cloudsearch', { keywords, limit, type: 100 });
}

// 歌手热门曲(→ { songs: [...] })
export async function artistTopSongs(id) {
  return ncmRequest('/artist/top/song', { id });
}
```

- [ ] **Step 2: playback-coordinator 加 `resolveById`**

`server/playback-coordinator.js` 顶部 import 已有 `songUrl, songDetail`。在 `resolvePlayList` 上方加:
```js
// 已知 ncm_id 时直接取直链(用于手动点播,跳过二次搜索)。
// 成功 → { ...found:true };取不到直链 → { found:false, reason:'unplayable', ncm_id }。
export async function resolveById({ ncm_id, title, artist }) {
  const config = await getConfig();
  const level = config.ncm.song_url_level;
  try {
    const urlResp = await songUrl(ncm_id, level);
    const data0 = urlResp?.data?.[0];
    const url = data0?.url;
    if (!url) return { title, artist, ncm_id, found: false, reason: 'unplayable' };

    let ncm_name = title, ncm_artist = artist, pic_url = null, duration_ms = 0;
    try {
      const detail = await songDetail([ncm_id]);
      const d = detail?.songs?.[0];
      if (d) {
        ncm_name = d.name || title;
        ncm_artist = (d.ar || []).map(a => a.name).join(' / ') || artist;
        pic_url = d.al?.picUrl || null;
        duration_ms = d.dt || 0;
      }
    } catch { /* 详情失败不致命,直链已拿到 */ }

    return { title, artist, ncm_id, url, pic_url, duration_ms, ncm_name, ncm_artist, found: true };
  } catch (e) {
    console.warn(`[playback] resolveById ${ncm_id} 失败: ${e.message}`);
    return { title, artist, ncm_id, found: false, reason: 'unplayable' };
  }
}
```

- [ ] **Step 3: 语法检查**

Run: `node --check server/ncm-client.js && node --check server/playback-coordinator.js && echo OK`
Expected: `OK`(功能在 Task 4 集成验证)

- [ ] **Step 4: commit**

```bash
git add server/ncm-client.js server/playback-coordinator.js
git commit -m "feat(server): add artist search/top-songs client + resolveById"
```

---

## Task 4: 4 个接口接线(index.js)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 补 import**

把 Task 1/2/3 的新模块引入 `server/index.js`(在现有 import 区):
```js
import { recommendSongs, personalFm, cloudsearch, searchArtists, artistTopSongs } from './ncm-client.js';
import { resolvePlayList, resolveById } from './playback-coordinator.js';
import { normalizeDailySongs, normalizeSearchSongs, normalizeSearchArtists, normalizeArtistSongs } from './search-normalize.js';
import { playNow, enqueue } from './queue-ops.js';
```
(注意:`recommendSongs, personalFm` 与 `resolvePlayList` 已有 import,合并去重,别重复声明。)

- [ ] **Step 2: `getRecommendPool` 用归一化 + 保留 id/封面**

把 `getRecommendPool` 里 `dailySongs.map(...)` 与 personalFm fallback 替换为归一化调用:
```js
    const data = await recommendSongs(20);
    const songs = normalizeDailySongs(data);
    if (songs.length) {
      recommendCache = { ts: Date.now(), songs };
      console.log(`[recommend] pool refreshed: ${songs.length} songs`);
    } else {
      const fm = await personalFm();
      const fmSongs = normalizeSearchSongs({ result: { songs: fm?.data || [] } });
      recommendCache = { ts: Date.now(), songs: fmSongs };
      console.log(`[recommend] pool from personalFm: ${fmSongs.length} songs`);
    }
```
(personalFm 的 `data[]` 用 `ar`/`al`,`normalizeSearchSongs` 的 `toSong` 能吃。)
**验证 DJ prompt 无回归**:`context-builder.js` 渲染推荐池只取 `name`/`artist`,多出的 `ncm_id`/`pic_url` 不影响。

- [ ] **Step 3: 加 4 个路由**

在现有 `app.get('/api/now', ...)` 附近加:
```js
// GET /api/recommend — 今日每日推荐池(带 ncm_id + 封面)
app.get('/api/recommend', async (req, res) => {
  const songs = await getRecommendPool();
  res.json({ songs });
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
app.post('/api/play', async (req, res) => {
  const { title, artist, ncm_id, mode } = req.body;
  if (!title && !ncm_id) return res.status(400).json({ error: 'title or ncm_id required' });
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
```
(`currentQueue` / `now` / `broadcast` / `recordQueue` 均为 index.js 现有的模块级变量/函数。)

- [ ] **Step 4: 语法检查 + 起服务**

Run: `node --check server/index.js && echo OK`
Expected: `OK`
然后(NCM + cookie 就绪下)起服务:`node --env-file=.env server/index.js`(后台或另开终端)。

- [ ] **Step 5: 集成验证(curl 运行中的 :8080)**

```bash
curl -s "http://localhost:8080/api/recommend" | head -c 300; echo
curl -s "http://localhost:8080/api/search?q=告五人&type=song" | head -c 300; echo
curl -s "http://localhost:8080/api/search?q=告五人&type=artist" | head -c 300; echo
```
Expected:
- `/api/recommend` → `{"songs":[{"ncm_id":...,"name":...,"artist":...,"pic_url":...}, ...]}`
- search song → `{"songs":[...]}`,每项含 `ncm_id`
- search artist → `{"artists":[{"artist_id":...,"name":"告五人","pic_url":...}]}`

取一个上面返回的 `artist_id` 验证下钻,再用一个 song 的 `ncm_id` 验证点播:
```bash
curl -s "http://localhost:8080/api/artist/songs?id=<artist_id>" | head -c 300; echo
curl -s -X POST "http://localhost:8080/api/play" -H "Content-Type: application/json" \
  -d '{"title":"爱人错过","artist":"告五人","ncm_id":<song_ncm_id>,"mode":"queue"}'; echo
```
Expected:`{"songs":[...]}`;play → `{"ok":true,"song":{...,"url":"http...","found":true}}`。VIP/无版权曲应返回 `{"ok":false,"reason":"unplayable"}`。

- [ ] **Step 6: commit**

```bash
git add server/index.js
git commit -m "feat(server): add recommend/search/artist-songs/play endpoints"
```

---

## Task 5: 共用行组件 + 播放 helper

**Files:**
- Create: `pwa/src/components/SongRow.vue`
- Create: `pwa/src/components/ArtistRow.vue`
- Modify: `pwa/src/ws-client.js`

- [ ] **Step 1: ws-client 加 `playSong`**

`pwa/src/ws-client.js` 末尾追加:
```js
// 手动点播/排队;mode: 'now' | 'queue'。返回 { ok, song? , reason? }。
export function playSong(song, mode) {
  return fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: song.name, artist: song.artist, ncm_id: song.ncm_id, mode }),
  }).then(r => r.json());
}
```

- [ ] **Step 2: SongRow.vue**

`pwa/src/components/SongRow.vue`:
```vue
<template>
  <div class="song-row" :class="{ cur: isNow }" @click="$emit('play', song)" :title="`播放: ${song.name}`">
    <div class="thumb" :style="song.pic_url ? { backgroundImage: `url(${song.pic_url})` } : null"></div>
    <div class="meta">
      <div class="name">{{ song.name }}<span v-if="isNow" class="now-tag"> ▸ 正在播</span></div>
      <div class="artist">{{ song.artist }}</div>
    </div>
    <button class="add" @click.stop="$emit('queue', song)" title="加入队列末尾">⊕</button>
  </div>
</template>

<script setup>
defineProps({ song: Object, isNow: Boolean });
defineEmits(['play', 'queue']);
</script>

<style scoped>
.song-row {
  display: flex; align-items: center; gap: 9px; padding: 7px 6px;
  cursor: pointer; border-left: 3px solid transparent; border-radius: 2px;
  transition: background 0.1s;
}
.song-row:hover { background: rgba(74, 127, 219, 0.08); }
.song-row.cur {
  background: var(--blue-glow); border-left-color: var(--accent);
  box-shadow: inset 0 0 22px rgba(74, 127, 219, 0.07);
}
.thumb {
  width: 30px; height: 30px; flex-shrink: 0; border: 1px solid var(--border);
  background-size: cover; background-position: center;
  background-color: #0a1024;
}
.meta { flex: 1; min-width: 0; }
.name {
  font-size: 12px; color: var(--text); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.song-row.cur .name { color: var(--accent); }
.now-tag { color: var(--accent); font-size: 10px; }
.artist {
  font-size: 10px; color: var(--text-dim); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; opacity: 0.8;
}
.add {
  flex-shrink: 0; width: 22px; height: 22px; border: 1px solid var(--border);
  border-radius: 2px; background: none; color: var(--text-dim);
  font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: color 0.15s, border-color 0.15s;
}
.add:hover { color: var(--accent); border-color: var(--blue); }
</style>
```

- [ ] **Step 3: ArtistRow.vue**

`pwa/src/components/ArtistRow.vue`:
```vue
<template>
  <div class="artist-row" @click="$emit('open', artist)" :title="`查看: ${artist.name}`">
    <div class="avatar" :style="artist.pic_url ? { backgroundImage: `url(${artist.pic_url})` } : null"></div>
    <div class="name">{{ artist.name }}</div>
    <span class="chev">›</span>
  </div>
</template>

<script setup>
defineProps({ artist: Object });
defineEmits(['open']);
</script>

<style scoped>
.artist-row {
  display: flex; align-items: center; gap: 10px; padding: 7px 6px;
  cursor: pointer; border-left: 3px solid transparent; border-radius: 2px;
  transition: background 0.1s;
}
.artist-row:hover { background: rgba(74, 127, 219, 0.08); }
.avatar {
  width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%;
  border: 1px solid var(--border); background-size: cover; background-position: center;
  background-color: #0a1024;
}
.name { flex: 1; min-width: 0; font-size: 12px; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chev { color: var(--text-dim); font-size: 15px; flex-shrink: 0; }
</style>
```

- [ ] **Step 4: 可视确认(随 Task 6/7 抽屉一起看到)**

本任务无独立 UI 入口;组件会在 Task 6(SongRow)、Task 7(SongRow + ArtistRow)里被抽屉渲染验证。

- [ ] **Step 5: commit**

```bash
git add pwa/src/components/SongRow.vue pwa/src/components/ArtistRow.vue pwa/src/ws-client.js
git commit -m "feat(pwa): add SongRow/ArtistRow components + playSong helper"
```

---

## Task 6: 每日推荐抽屉 + ♪ 入口

**Files:**
- Create: `pwa/src/components/RecommendDrawer.vue`
- Modify: `pwa/src/components/AppHeader.vue`
- Modify: `pwa/src/App.vue`

- [ ] **Step 1: RecommendDrawer.vue**

`pwa/src/components/RecommendDrawer.vue`:
```vue
<template>
  <transition name="drawer">
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">┌─ 每日推荐 · {{ songs.length }} ─┐</span>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>
        <div class="cap">网易云 · 每天更新 · 用你的账号拉取</div>
        <div v-if="toast" class="toast">{{ toast }}</div>

        <div class="body">
          <div v-if="loading" class="hint">加载中…</div>
          <div v-else-if="!songs.length" class="hint">今天的每日推荐没拉到 —— 检查网易云登录或稍后再试</div>
          <SongRow
            v-for="s in songs" :key="s.ncm_id"
            :song="s" :is-now="isNow(s)"
            @play="onPlay" @queue="onQueue"
          />
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch } from 'vue';
import SongRow from './SongRow.vue';
import { playSong } from '../ws-client.js';

const props = defineProps({ open: Boolean, now: Object });
defineEmits(['close']);

const songs = ref([]);
const loading = ref(false);
const toast = ref('');
let loaded = false;

watch(() => props.open, (isOpen) => {
  if (isOpen && (!loaded || !songs.value.length)) load();
});

async function load() {
  loading.value = true;
  try {
    const r = await fetch('/api/recommend').then(r => r.json());
    songs.value = r.songs || [];
    loaded = true;
  } catch { songs.value = []; }
  finally { loading.value = false; }
}

function isNow(s) {
  return props.now && (props.now.ncm_id === s.ncm_id || props.now.title === s.name);
}
function flashToast(msg) { toast.value = msg; setTimeout(() => { toast.value = ''; }, 2500); }
async function onPlay(s) {
  const r = await playSong(s, 'now');
  if (!r.ok) flashToast(r.reason === 'unplayable' ? '这首拿不到,可能 VIP 或无版权' : '没找到可播的原唱');
}
async function onQueue(s) {
  const r = await playSong(s, 'queue');
  flashToast(r.ok ? `已加入队列:${s.name}` : '这首拿不到,没能加入队列');
}
</script>

<style scoped>
.drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200; display: flex; justify-content: flex-end; }
.drawer { background: var(--panel); border-left: 1px solid var(--border); width: 340px; max-width: 90vw; height: 100%; padding: 24px 20px; display: flex; flex-direction: column; gap: 10px; }
.drawer-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.drawer-title { font-size: 11px; color: var(--text-dim); letter-spacing: 1px; }
.close-btn { background: none; border: 1px solid var(--border); color: var(--text-dim); width: 28px; height: 28px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.close-btn:hover { color: var(--accent); border-color: var(--accent-dim); }
.cap { font-size: 9px; color: var(--text-dim); opacity: 0.7; flex-shrink: 0; }
.toast { font-size: 11px; color: var(--accent); border: 1px solid var(--blue); background: var(--blue-glow); padding: 6px 8px; border-radius: 3px; flex-shrink: 0; }
.body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.hint { font-size: 12px; color: var(--text-dim); padding: 12px 4px; text-align: center; }
.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
```

- [ ] **Step 2: AppHeader 加 ♪ 图标**

`pwa/src/components/AppHeader.vue` —— 在 `header-actions` 里、`☰` 之前加按钮,并扩展 emits:
```html
    <div class="header-actions">
      <button class="icon-btn" title="每日推荐" @click="$emit('open-recommend')">♪</button>
      <button class="icon-btn" title="队列" @click="$emit('open-queue')">☰</button>
      <button class="icon-btn" title="调音台" @click="$emit('open-tuning')">⚙</button>
    </div>
```
```js
defineEmits(['open-tuning', 'open-queue', 'open-recommend', 'open-search']);
```
(`open-search` 一并加上,Task 7 用。)

- [ ] **Step 3: App.vue 接线**

`pwa/src/App.vue`:
1. import + ref:
```js
import RecommendDrawer from './components/RecommendDrawer.vue';
const recommendOpen = ref(false);
```
2. AppHeader 上接事件:
```html
<AppHeader
  @open-tuning="tuningOpen = true"
  @open-queue="queueOpen = true"
  @open-recommend="recommendOpen = true"
/>
```
3. 在 `<QueueDrawer .../>` 之后渲染:
```html
<RecommendDrawer :open="recommendOpen" :now="state.now" @close="recommendOpen = false" />
```

- [ ] **Step 4: 可视验证**

前置就绪后 `cd pwa && npm run dev`,开 http://localhost:5173:
- [ ] 顶栏出现 ♪;点开右滑抽屉,标题 `┌─ 每日推荐 · N ─┐`,列出带封面的歌。
- [ ] 点某一行 → HeroCard 立即换歌播放(`now` 变),抽屉保持打开,当前行显示「▸ 正在播」高亮。
- [ ] 点某行 ⊕ → 顶部 toast「已加入队列」;打开 ☰ 队列抽屉能看到它在末尾;当前歌没被打断。
- [ ] 视觉与现有抽屉一致(同字体/边框/蓝辉光)。截图留档。

- [ ] **Step 5: commit**

```bash
git add pwa/src/components/RecommendDrawer.vue pwa/src/components/AppHeader.vue pwa/src/App.vue
git commit -m "feat(pwa): daily-recommend drawer + header entry"
```

---

## Task 7: 搜索抽屉(歌曲/歌手 + 下钻)+ 🔍 入口

**Files:**
- Create: `pwa/src/components/SearchDrawer.vue`
- Modify: `pwa/src/App.vue`

- [ ] **Step 1: SearchDrawer.vue**

`pwa/src/components/SearchDrawer.vue`:
```vue
<template>
  <transition name="drawer">
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">┌─ 搜索 ─┐</span>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>

        <div class="seg">
          <button :class="{ active: mode === 'song' }" @click="setMode('song')">歌曲</button>
          <button :class="{ active: mode === 'artist' }" @click="setMode('artist')">歌手</button>
        </div>
        <input ref="box" v-model="query" class="search-input" placeholder="输入歌名或歌手…" />
        <div v-if="toast" class="toast">{{ toast }}</div>

        <div class="body">
          <div v-if="loading" class="hint">搜索中…</div>

          <!-- 歌手下钻:某歌手的热门曲 -->
          <template v-else-if="mode === 'artist' && view === 'artist-songs'">
            <div class="back" @click="view = 'artists'">‹ 返回 · {{ activeArtist?.name }}</div>
            <div v-if="!songs.length" class="hint">该歌手暂无可播热门曲</div>
            <SongRow v-for="s in songs" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
          </template>

          <!-- 歌手结果列表 -->
          <template v-else-if="mode === 'artist'">
            <div v-if="!query" class="hint">输入歌手名开始搜索</div>
            <div v-else-if="!artists.length" class="hint">没找到「{{ query }}」的歌手</div>
            <ArtistRow v-for="a in artists" :key="a.artist_id" :artist="a" @open="openArtist" />
          </template>

          <!-- 歌曲结果列表 -->
          <template v-else>
            <div v-if="!query" class="hint">输入歌名开始搜索</div>
            <div v-else-if="!songs.length" class="hint">没找到「{{ query }}」的歌曲</div>
            <SongRow v-for="s in songs" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import SongRow from './SongRow.vue';
import ArtistRow from './ArtistRow.vue';
import { playSong } from '../ws-client.js';

const props = defineProps({ open: Boolean, now: Object });
defineEmits(['close']);

const mode = ref('song');         // 'song' | 'artist'
const view = ref('artists');      // artist 模式内:'artists' | 'artist-songs'
const query = ref('');
const songs = ref([]);
const artists = ref([]);
const activeArtist = ref(null);
const loading = ref(false);
const toast = ref('');
const box = ref(null);

let timer = null;

watch(() => props.open, (isOpen) => {
  if (isOpen) nextTick(() => box.value?.focus());
});

watch([query, mode], () => {
  if (mode.value === 'artist') view.value = 'artists';
  clearTimeout(timer);
  const q = query.value.trim();
  if (!q) { songs.value = []; artists.value = []; return; }
  timer = setTimeout(runSearch, 300);
});

function setMode(m) { mode.value = m; }

async function runSearch() {
  const q = query.value.trim();
  if (!q) return;
  loading.value = true;
  try {
    if (mode.value === 'artist') {
      const r = await fetch(`/api/search?type=artist&q=${encodeURIComponent(q)}`).then(r => r.json());
      artists.value = r.artists || [];
    } else {
      const r = await fetch(`/api/search?type=song&q=${encodeURIComponent(q)}`).then(r => r.json());
      songs.value = r.songs || [];
    }
  } catch { songs.value = []; artists.value = []; }
  finally { loading.value = false; }
}

async function openArtist(a) {
  activeArtist.value = a;
  view.value = 'artist-songs';
  loading.value = true;
  try {
    const r = await fetch(`/api/artist/songs?id=${a.artist_id}`).then(r => r.json());
    songs.value = r.songs || [];
  } catch { songs.value = []; }
  finally { loading.value = false; }
}

function isNow(s) {
  return props.now && (props.now.ncm_id === s.ncm_id || props.now.title === s.name);
}
function flashToast(msg) { toast.value = msg; setTimeout(() => { toast.value = ''; }, 2500); }
async function onPlay(s) {
  const r = await playSong(s, 'now');
  if (!r.ok) flashToast(r.reason === 'unplayable' ? '这首拿不到,可能 VIP 或无版权' : '没找到可播的原唱');
}
async function onQueue(s) {
  const r = await playSong(s, 'queue');
  flashToast(r.ok ? `已加入队列:${s.name}` : '这首拿不到,没能加入队列');
}
</script>

<style scoped>
.drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 200; display: flex; justify-content: flex-end; }
.drawer { background: var(--panel); border-left: 1px solid var(--border); width: 340px; max-width: 90vw; height: 100%; padding: 24px 20px; display: flex; flex-direction: column; gap: 10px; }
.drawer-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.drawer-title { font-size: 11px; color: var(--text-dim); letter-spacing: 1px; }
.close-btn { background: none; border: 1px solid var(--border); color: var(--text-dim); width: 28px; height: 28px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.close-btn:hover { color: var(--accent); border-color: var(--accent-dim); }
.seg { display: flex; gap: 6px; flex-shrink: 0; }
.seg button { flex: 1; background: transparent; border: 1px solid var(--border); color: var(--text-dim); font-family: inherit; font-size: 11px; padding: 6px 0; cursor: pointer; border-radius: 3px; transition: all 0.15s; }
.seg button.active { border-color: var(--blue); color: var(--accent); background: var(--blue-glow); }
.search-input { background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 8px 10px; font-family: inherit; font-size: 12px; outline: none; border-radius: 3px; flex-shrink: 0; }
.search-input:focus { border-color: var(--blue); }
.toast { font-size: 11px; color: var(--accent); border: 1px solid var(--blue); background: var(--blue-glow); padding: 6px 8px; border-radius: 3px; flex-shrink: 0; }
.body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.hint { font-size: 12px; color: var(--text-dim); padding: 12px 4px; text-align: center; }
.back { font-size: 11px; color: var(--accent); cursor: pointer; padding: 6px 4px; }
.back:hover { text-decoration: underline; }
.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
```

- [ ] **Step 2: App.vue 接线**

`pwa/src/App.vue`:
1. import + ref:
```js
import SearchDrawer from './components/SearchDrawer.vue';
const searchOpen = ref(false);
```
2. AppHeader 接事件(在已有 `@open-recommend` 旁):
```html
  @open-search="searchOpen = true"
```
3. 在 `<RecommendDrawer .../>` 之后渲染:
```html
<SearchDrawer :open="searchOpen" :now="state.now" @close="searchOpen = false" />
```
4. AppHeader 加 🔍 按钮(`pwa/src/components/AppHeader.vue`,放在 ♪ 之前):
```html
      <button class="icon-btn" title="搜索" @click="$emit('open-search')">🔍</button>
```

- [ ] **Step 3: 可视验证**

`cd pwa && npm run dev`,http://localhost:5173:
- [ ] 顶栏出现 🔍;点开抽屉,有 `歌曲 | 歌手` 切换 + 输入框(自动聚焦)。
- [ ] 歌曲模式:输入歌名,300ms 后出结果;点歌即播、⊕ 排队、toast 正常;无结果显示「没找到…」。
- [ ] 歌手模式:输入歌手 → 出歌手列表(圆头像);点一个 → 「‹ 返回」+ 其热门曲;点歌即播 / ⊕ 排队;点返回回到歌手列表。
- [ ] 切回「歌曲」或改关键词 → 视图复位、结果刷新。
- [ ] VIP/无版权曲点播 → toast「拿不到…」,不崩。
- [ ] 截图留档(歌曲、歌手、下钻三态)。

- [ ] **Step 4: commit**

```bash
git add pwa/src/components/SearchDrawer.vue pwa/src/components/AppHeader.vue pwa/src/App.vue
git commit -m "feat(pwa): search drawer (song/artist + drill-down) + header entry"
```

---

## Task 8: 回归 + 收尾

**Files:** 无新增(验证为主)

- [ ] **Step 1: 后端全量单测**

Run: `node --env-file=.env --test --test-concurrency=1 "tests/**/*.test.js"`
Expected: 全绿(含新增 search-normalize、queue-ops;原有测试不受影响)。

- [ ] **Step 2: DJ 推荐链路无回归**

对运行中的 server 发一轮 chat,确认每日推荐池仍进 prompt 且 DJ 正常出歌:
```bash
curl -s -X POST "http://localhost:8080/api/chat" -H "Content-Type: application/json" -d '{"message":"随便来几首"}'; echo
```
Expected:`{"ok":true,...}`;服务日志出现 `[recommend] pool refreshed: N songs` 与 `[chat] intent=recommend`。

- [ ] **Step 3: 前端构建通过**

Run: `cd pwa && npm run build`
Expected: 构建成功,无报错(确认生产构建也 OK)。

- [ ] **Step 4: 端到端可视烟测**

`node --env-file=.env server/index.js` + 访问构建产物(server 静态托管 `pwa/dist`)或 vite dev:
- [ ] 每日推荐:点播 + ⊕ 排队。
- [ ] 搜索:歌曲、歌手、歌手下钻,各点播一次。
- [ ] 三个抽屉(♪ 🔍 ☰)互不打架;关闭/打开正常。

- [ ] **Step 5: 最终 commit(若有未提交收尾)**

```bash
git add -A
git commit -m "chore: recommend+search feature regression pass"
```

---

## 自检(spec 覆盖核对)

- 每日推荐入口(♪ + 抽屉 + GET /api/recommend + 保留 id/封面)→ Task 4 §2/§3、Task 6 ✓
- 搜索-歌曲(🔍 + 抽屉 + GET /api/search?type=song)→ Task 4、Task 7 ✓
- 搜索-歌手 + 下钻(type=artist + /api/artist/songs + ArtistRow + 两级视图)→ Task 3、Task 4、Task 5、Task 7 ✓
- 点即播(mode=now 插当前之后)/ ⊕ 排队(mode=queue)→ Task 2、Task 4、Task 5/6/7 ✓
- 复用 playback-coordinator 取原唱(resolveById / resolvePlayList)→ Task 3、Task 4 ✓
- 不打断 DJ + play-event 由前端照常上报 → Task 4(playNow 插入而非清空)✓
- 错误处理(空池 / 无结果 / unplayable / 网络)→ Task 4(返回体)、Task 6/7(空态 + toast)✓
- 测试:归一化 + 队列 ops 单测;接口/前端集成与可视验证 → Task 1、2、4、6、7、8 ✓
- 非目标(专辑/歌单、刷新、底部栏)→ 未列入任务,符合 spec ✓
