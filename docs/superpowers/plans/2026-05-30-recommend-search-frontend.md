# 每日推荐 + 搜索 前端入口 Implementation Plan

> **状态(2026-06-12)**:已规划、**未实现**,所有 task 均未开始。2026-06-12 改版:前端从双抽屉改为「夜刊整版页」(Task 5–7 已按新方向重写);后端 Task 1–4 不变。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 NightlinerFM 加 masthead 入口(DAILY / SEARCH)——打开同一个夜刊风整版页:空态是每日推荐封面卡网格,输入即搜(歌曲/歌手 + 下钻);点卡/行即播、⊕ 加队列,复用现有播放链路。

**Architecture:** 后端把已有的 NCM 能力暴露成 4 个接口(recommend / search / artist-songs / play),纯逻辑(结果归一化、队列变更)抽成可单测的小模块;前端加一个整版覆盖层 `DiscoverPage`(night-issue token:ink/paper/gold + serif)+ 三个行/卡组件,页面自包含调接口,播放经 ws 广播 `now`/`queue` 驱动现有 `<audio>`。

**Tech Stack:** Node + Express + ws(后端);Vue 3 + Vite(PWA);`node:test`(后端单测);NeteaseCloudMusicApi(127.0.0.1:3000)。

**关联 spec:** `docs/superpowers/specs/2026-05-30-recommend-search-frontend-design.md`(2026-06-12 改版)

**约定:**
- 在独立分支/worktree 上执行(由 using-git-worktrees 在执行期创建)。
- 每个 commit message 末尾加一行:`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`(下方示例省略)。
- 后端单测命令:`node --env-file=.env --test --test-concurrency=1 "tests/**/*.test.js"`(单文件:`node --test tests/<file>.test.js`)。
- 前端可视验证前置:NCM API(`scripts/start-ncm-api.ps1`)、`data/netease-cookie.txt` 有效、`node --env-file=.env server/index.js` 已起、`cd pwa && npm run dev` 开 vite(:5173 代理 /api、/stream 到 :8080)。
- 前端 chrome 文案一律英文短句、不带感叹号(见 memory: no AI-flavored copy);样式只用 night-issue token(`--ink-*` `--paper-*` `--gold` `--rule` `--negative`),图标一律走 `Icon.vue`。

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
- Modify: `server/playback-coordinator.js`(`resolvePlayList` 之前加 `resolveById`)

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

## Task 5: Icon 路径 + playSong helper + 行/卡组件

**Files:**
- Modify: `pwa/src/components/Icon.vue`(PATHS 增补)
- Modify: `pwa/src/ws-client.js`(加 `playSong`)
- Create: `pwa/src/components/SongRow.vue`
- Create: `pwa/src/components/ArtistRow.vue`
- Create: `pwa/src/components/SongCard.vue`

- [ ] **Step 1: Icon.vue 增补 4 个 lucide 路径**

在 `pwa/src/components/Icon.vue` 的 `PATHS` 对象末尾(`'x'` 之后)追加:
```js
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
```

- [ ] **Step 2: ws-client 加 `playSong`**

`pwa/src/ws-client.js` 末尾追加:
```js
// 手动点播/排队;mode: 'now' | 'queue'。返回 { ok, song?, reason? }。
export function playSong(song, mode) {
  return fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: song.name, artist: song.artist, ncm_id: song.ncm_id, mode }),
  }).then(r => r.json());
}
```

- [ ] **Step 3: SongRow.vue(搜索结果行)**

`pwa/src/components/SongRow.vue`:
```vue
<template>
  <div class="song-row" :class="{ current: isNow }" @click="$emit('play', song)" :title="`Play ${song.name}`">
    <span class="name">{{ song.name }}</span>
    <span class="artist">{{ song.artist }}</span>
    <button class="add" @click.stop="$emit('queue', song)" :aria-label="`Queue ${song.name}`">
      <Icon name="plus" :size="14" />
    </button>
  </div>
</template>

<script setup>
import Icon from './Icon.vue';

defineProps({ song: Object, isNow: Boolean });
defineEmits(['play', 'queue']);
</script>

<style scoped>
.song-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; font-size: 13px; color: var(--paper-3);
  cursor: pointer; transition: background 0.1s;
  border-left: 2px solid transparent;
}
.song-row:hover { background: rgba(194, 163, 107, 0.07); }
.song-row.current { border-left-color: var(--gold); color: var(--gold); }
.name { font-family: var(--font-serif); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artist { font-family: var(--font-sans); font-size: 11px; color: var(--paper-4); text-align: right; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.song-row.current .artist { color: var(--gold); }
.add {
  background: none; border: none; padding: 0; flex-shrink: 0;
  width: 24px; height: 24px; cursor: pointer; color: var(--paper-4);
  display: flex; align-items: center; justify-content: center;
  transition: color 0.18s;
}
.add:hover { color: var(--paper-0); }
</style>
```

- [ ] **Step 4: ArtistRow.vue(歌手行)**

`pwa/src/components/ArtistRow.vue`:
```vue
<template>
  <div class="artist-row" @click="$emit('open', artist)" :title="`Open ${artist.name}`">
    <img v-if="artist.pic_url" :src="artist.pic_url" :alt="artist.name" class="avatar" loading="lazy" />
    <span v-else class="avatar avatar-empty"></span>
    <span class="name">{{ artist.name }}</span>
    <Icon name="chevron-right" :size="14" class="chev" />
  </div>
</template>

<script setup>
import Icon from './Icon.vue';

defineProps({ artist: Object });
defineEmits(['open']);
</script>

<style scoped>
.artist-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; cursor: pointer; transition: background 0.1s;
  border-left: 2px solid transparent;
}
.artist-row:hover { background: rgba(194, 163, 107, 0.07); }
.avatar {
  width: 30px; height: 30px; border-radius: 50%;
  object-fit: cover; flex-shrink: 0;
  background: var(--ink-2); display: inline-block;
}
.name { font-family: var(--font-serif); font-size: 13px; color: var(--paper-1); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { color: var(--paper-4); flex-shrink: 0; }
</style>
```

- [ ] **Step 5: SongCard.vue(每日推荐封面卡)**

`pwa/src/components/SongCard.vue`:
```vue
<template>
  <div class="song-card" :class="{ current: isNow }" @click="$emit('play', song)" :title="`Play ${song.name}`">
    <div class="cover">
      <img v-if="song.pic_url" :src="song.pic_url" :alt="song.name" loading="lazy" />
      <Icon v-else name="disc" :size="28" class="cover-empty" />
      <button class="add" @click.stop="$emit('queue', song)" :aria-label="`Queue ${song.name}`">
        <Icon name="plus" :size="13" />
      </button>
    </div>
    <div class="name">{{ song.name }}</div>
    <div class="artist">{{ song.artist }}<span v-if="isNow" class="playing-tag"> · playing</span></div>
  </div>
</template>

<script setup>
import Icon from './Icon.vue';

defineProps({ song: Object, isNow: Boolean });
defineEmits(['play', 'queue']);
</script>

<style scoped>
.song-card { cursor: pointer; min-width: 0; }
.cover {
  position: relative; aspect-ratio: 1;
  border: 1px solid var(--ink-2); border-radius: 6px;
  overflow: hidden; background: var(--ink-1);
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.18s;
}
.song-card:hover .cover { border-color: var(--rule); }
.song-card.current .cover { border-color: var(--gold); }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-empty { color: var(--paper-4); }
.add {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px; border-radius: 50%;
  border: 1px solid var(--paper-3); background: rgba(19, 17, 16, 0.6);
  color: var(--paper-1); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.18s, border-color 0.18s;
}
.add:hover { color: var(--gold); border-color: var(--gold); }
.name {
  font-family: var(--font-serif); font-size: 13px; color: var(--paper-1);
  margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.song-card.current .name { color: var(--gold); }
.artist {
  font-family: var(--font-sans); font-size: 11px; color: var(--paper-4);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.playing-tag { color: var(--gold); }
</style>
```

- [ ] **Step 6: 构建检查**

Run: `cd pwa && npm run build`
Expected: 构建成功(组件在 Task 6 被 DiscoverPage 渲染后做可视验证)。

- [ ] **Step 7: commit**

```bash
git add pwa/src/components/Icon.vue pwa/src/ws-client.js pwa/src/components/SongRow.vue pwa/src/components/ArtistRow.vue pwa/src/components/SongCard.vue
git commit -m "feat(pwa): song/artist rows + daily card + playSong helper + new icons"
```

---

## Task 6: DiscoverPage 整版页组件

**Files:**
- Create: `pwa/src/components/DiscoverPage.vue`

- [ ] **Step 1: 写组件(完整)**

`pwa/src/components/DiscoverPage.vue`:
```vue
<template>
  <transition name="page">
    <div v-if="open" class="page-overlay">
      <div class="page-col">
        <div class="top-row">
          <div class="search-bar" :class="{ active: query.trim() }">
            <Icon name="search" :size="15" class="search-ic" />
            <input ref="box" v-model="query" placeholder="Search songs or artists…" />
            <button v-if="query" class="ghost" @click="query = ''" aria-label="Clear">
              <Icon name="x" :size="13" />
            </button>
          </div>
          <button class="ghost close" @click="$emit('close')" aria-label="Close">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div v-if="toast" class="toast">{{ toast }}</div>

        <div class="body">
          <template v-if="!query.trim()">
            <div class="section-label">TODAY — {{ dateLabel }}<span v-if="daily.length"> · {{ daily.length }} TRACKS</span></div>
            <div v-if="dailyLoading" class="hint">Loading…</div>
            <div v-else-if="!daily.length" class="hint">Couldn't fetch today's picks — check NetEase login.</div>
            <div v-else class="card-grid">
              <SongCard v-for="s in daily" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
            </div>
          </template>

          <template v-else>
            <div class="seg">
              <button :class="{ active: mode === 'song' }" @click="mode = 'song'">SONGS</button>
              <button :class="{ active: mode === 'artist' }" @click="mode = 'artist'">ARTISTS</button>
            </div>
            <div v-if="loading" class="hint">Searching…</div>
            <template v-else-if="mode === 'artist' && view === 'artist-songs'">
              <button class="back" @click="view = 'artists'">
                <Icon name="chevron-left" :size="13" /> {{ activeArtist?.name }} — TOP SONGS
              </button>
              <div v-if="!songs.length" class="hint">No playable tracks for this artist.</div>
              <SongRow v-for="s in songs" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
            </template>
            <template v-else-if="mode === 'artist'">
              <div v-if="!artists.length" class="hint">Nothing found for "{{ query.trim() }}".</div>
              <ArtistRow v-for="a in artists" :key="a.artist_id" :artist="a" @open="openArtist" />
            </template>
            <template v-else>
              <div v-if="!songs.length" class="hint">Nothing found for "{{ query.trim() }}".</div>
              <SongRow v-for="s in songs" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
            </template>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import Icon from './Icon.vue';
import SongCard from './SongCard.vue';
import SongRow from './SongRow.vue';
import ArtistRow from './ArtistRow.vue';
import { playSong } from '../ws-client.js';

const props = defineProps({ open: Boolean, focusSearch: Boolean, now: Object });
const emit = defineEmits(['close']);

const query = ref('');
const mode = ref('song');          // 'song' | 'artist'
const view = ref('artists');       // artist 模式内:'artists' | 'artist-songs'
const daily = ref([]);
const dailyLoading = ref(false);
let dailyLoaded = false;
const songs = ref([]);
const artists = ref([]);
const activeArtist = ref(null);
const loading = ref(false);
const toast = ref('');
const box = ref(null);
let timer = null;
let toastTimer = null;

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dateLabel = computed(() => {
  const d = new Date();
  return `${DAYS[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
});

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('keydown', onKey);
    if (!dailyLoaded || !daily.value.length) loadDaily();
    if (props.focusSearch) nextTick(() => box.value?.focus());
  } else {
    window.removeEventListener('keydown', onKey);
  }
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  clearTimeout(timer);
  clearTimeout(toastTimer);
});

watch([query, mode], () => {
  view.value = 'artists';
  clearTimeout(timer);
  const q = query.value.trim();
  if (!q) { songs.value = []; artists.value = []; return; }
  timer = setTimeout(runSearch, 300);
});

async function loadDaily() {
  dailyLoading.value = true;
  try {
    const r = await fetch('/api/recommend').then(r => r.json());
    daily.value = r.songs || [];
    dailyLoaded = true;
  } catch { daily.value = []; }
  finally { dailyLoading.value = false; }
}

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
  if (!props.now) return false;
  if (props.now.ncm_id != null && s.ncm_id != null) return props.now.ncm_id === s.ncm_id;
  return props.now.title === s.name;
}

function flashToast(msg) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 2500);
}

async function onPlay(s) {
  const r = await playSong(s, 'now');
  if (!r.ok) {
    flashToast(r.reason === 'unplayable'
      ? "Can't play this one — VIP or region-locked."
      : "Couldn't find a playable original.");
  }
}

async function onQueue(s) {
  const r = await playSong(s, 'queue');
  flashToast(r.ok ? `Queued — ${s.name}` : "Can't queue this one — VIP or region-locked.");
}
</script>

<style scoped>
.page-overlay {
  position: fixed; inset: 0;
  background: var(--ink-0);
  z-index: 300;
}
.page-col {
  max-width: 720px; margin: 0 auto; height: 100%;
  padding: 0 16px;
  display: flex; flex-direction: column;
}
.top-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 0 0; flex-shrink: 0;
}
.search-bar {
  flex: 1; display: flex; align-items: center; gap: 8px;
  padding: 8px 2px; border-bottom: 1px solid var(--rule);
  transition: border-color 0.18s;
}
.search-bar:focus-within, .search-bar.active { border-bottom-color: var(--gold); }
.search-ic { color: var(--paper-3); flex-shrink: 0; }
.search-bar:focus-within .search-ic, .search-bar.active .search-ic { color: var(--gold); }
.search-bar input {
  flex: 1; border: none; background: transparent;
  color: var(--paper-0); font-family: var(--font-serif); font-size: 14px;
  outline: none; padding: 0; min-width: 0;
}
.search-bar input::placeholder { color: var(--paper-4); }
.ghost {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--paper-3); display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex-shrink: 0;
  transition: color 0.18s;
}
.ghost:hover { color: var(--paper-0); }
.toast {
  font-family: var(--font-sans); font-size: 11px; letter-spacing: 0.5px;
  color: var(--gold); border: 1px solid var(--gold); border-radius: 2px;
  padding: 6px 10px; margin-top: 10px; flex-shrink: 0;
}
.body { flex: 1; overflow-y: auto; padding: 14px 0 24px; }
.section-label {
  font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px;
  color: var(--paper-3); margin-bottom: 12px;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
}
.hint { font-family: var(--font-sans); font-size: 12px; color: var(--paper-4); padding: 10px 0; }
.seg { display: flex; gap: 8px; margin-bottom: 12px; }
.seg button {
  background: none; cursor: pointer;
  font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px;
  color: var(--paper-3); border: 1px solid var(--ink-2); border-radius: 2px;
  padding: 4px 12px; transition: color 0.18s, border-color 0.18s;
}
.seg button.active { color: var(--gold); border-color: var(--gold); }
.back {
  background: none; border: none; padding: 6px 0; cursor: pointer;
  display: flex; align-items: center; gap: 4px;
  font-family: var(--font-sans); font-size: 10px; letter-spacing: 1.5px;
  color: var(--gold);
}
.page-enter-active, .page-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.page-enter-from, .page-leave-to { opacity: 0; transform: translateY(16px); }
</style>
```

- [ ] **Step 2: 构建检查**

Run: `cd pwa && npm run build`
Expected: 构建成功(还没有入口,Task 7 接线后做可视验证)。

- [ ] **Step 3: commit**

```bash
git add pwa/src/components/DiscoverPage.vue
git commit -m "feat(pwa): discover page — daily picks grid + song/artist search"
```

---

## Task 7: masthead 入口 + App 接线 + 可视验证

**Files:**
- Modify: `pwa/src/components/AppHeader.vue`
- Modify: `pwa/src/App.vue`

- [ ] **Step 1: AppHeader 加 DAILY / SEARCH 链接**

`pwa/src/components/AppHeader.vue` 的 `mast-actions` 里、`QUEUE` 之前加(顺序:ON AIR → DAILY → SEARCH → QUEUE → TUNING):
```html
        <button class="nav-link" @click="$emit('open-daily')">DAILY</button>
        <button class="nav-link" @click="$emit('open-search')">SEARCH</button>
```
并扩展 emits:
```js
defineEmits(['open-tuning', 'open-queue', 'open-daily', 'open-search']);
```

- [ ] **Step 2: App.vue 接线**

`pwa/src/App.vue`:
1. import + ref:
```js
import DiscoverPage from './components/DiscoverPage.vue';
const discoverOpen = ref(false);
const discoverFocusSearch = ref(false);
function openDiscover(focusSearch) {
  discoverFocusSearch.value = focusSearch;
  discoverOpen.value = true;
}
```
2. AppHeader 上接事件:
```html
    <AppHeader
      :connected="connected" :playing="playing"
      @open-tuning="tuningOpen = true"
      @open-queue="queueOpen = true"
      @open-daily="openDiscover(false)"
      @open-search="openDiscover(true)"
    />
```
3. 在 `<QueueDrawer .../>` 之后渲染:
```html
    <DiscoverPage
      :open="discoverOpen"
      :focus-search="discoverFocusSearch"
      :now="state.now"
      @close="discoverOpen = false"
    />
```
4. `onCommand` 的 switch 里、`case 'queue'` 之后加:
```js
    case 'daily':
      openDiscover(false);
      break;
    case 'search':
      openDiscover(true);
      break;
```
并在 `/help` 文案里补两行:`/daily          打开每日推荐`、`/search         打开搜索`。

- [ ] **Step 3: 可视验证(逐项,截图留档)**

前置就绪后 `cd pwa && npm run dev`,开 http://localhost:5173:
- [ ] masthead 显示 `DAILY SEARCH QUEUE TUNING`,手机宽度(375px)不换行不挤掉 wordmark。
- [ ] 点 DAILY → 整版页上滑淡入,栏目标签 `TODAY — {DOW} · {DD MMM} · N TRACKS`,封面卡网格(桌面 4 列左右,手机 2 列),封面图正常加载。
- [ ] 点 SEARCH → 同一页打开且输入框自动聚焦。
- [ ] 点某张卡 → HeroCard 立即换歌播放,页面保持打开,该卡金边 + `· playing`。
- [ ] 点卡角 ⊕ → toast `Queued — {name}`;开 QUEUE 抽屉确认它在末尾;当前歌没被打断。
- [ ] 输入歌名 → 300ms 后出 SongRow 结果;点行即播;⊕ 排队;无结果显示 `Nothing found for "{q}".`。
- [ ] 切 ARTISTS → 输入歌手 → 歌手列表(圆头像);点一行 → `‹ {歌手} — TOP SONGS` + 热门曲;返回正常;切回 SONGS 或改词视图复位。
- [ ] 清空输入 → 回到今日推荐卡片。
- [ ] VIP/无版权曲点播 → toast `Can't play this one — VIP or region-locked.`,不崩。
- [ ] Esc 关闭;✕ 关闭;再开不重复拉每日推荐(network 面板确认)。
- [ ] 版式与 night-issue 一致:serif 歌名、sans 小字距标签、金色只用于 active/playing。

- [ ] **Step 4: commit**

```bash
git add pwa/src/components/AppHeader.vue pwa/src/App.vue
git commit -m "feat(pwa): masthead DAILY/SEARCH entries + discover wiring"
```

---

## Task 8: 回归 + 文档同步 + 收尾

**Files:**
- Modify: `nightliner-design-v0.5.md`(补手动点播小节)

- [ ] **Step 1: 后端全量单测**

Run: `node --env-file=.env --test --test-concurrency=1 "tests/**/*.test.js"`
Expected: 全绿(含新增 search-normalize、queue-ops;原有测试不受影响)。

- [ ] **Step 2: DJ 推荐链路无回归**

对运行中的 server 发一轮 chat,确认每日推荐池仍进 prompt 且 DJ 正常出歌:
```bash
curl -s -X POST "http://localhost:8080/api/chat" -H "Content-Type: application/json" -d '{"message":"随便来几首"}'; echo
```
Expected:`{"ok":true,...}`;服务日志出现 `[recommend] pool refreshed: N songs` 与 `[chat] intent=recommend`。

- [ ] **Step 3: 前端生产构建**

Run: `cd pwa && npm run build`
Expected: 构建成功,无报错。

- [ ] **Step 4: 端到端可视烟测**

`node --env-file=.env server/index.js` + 访问构建产物(server 静态托管 `pwa/dist`):
- [ ] DAILY:点卡即播 + ⊕ 排队。
- [ ] SEARCH:歌曲、歌手、歌手下钻,各点播一次。
- [ ] 整版页与 QUEUE / TUNING 抽屉互不打架;关闭/打开正常。

- [ ] **Step 5: 同步 nightliner-design-v0.5.md(维护纪律)**

`/api/play` 是新的播放行为入口(手动点播绕过 DJ),按 CLAUDE.md 纪律在 v0.5 文档补一小节「手动点播(DAILY / SEARCH 整版页)」:4 个接口一览、mode now/queue 的队列语义(插当前歌之后 / 追加队尾)、不校验 anti/cooldown 的原因、play-event 照常由前端上报。

- [ ] **Step 6: 最终 commit**

```bash
git add nightliner-design-v0.5.md
git commit -m "docs(design): document manual playback entries (daily/search page)"
```

---

## 自检(spec 覆盖核对)

- 每日推荐整版态(DAILY 入口 + SongCard 网格 + GET /api/recommend + 保留 id/封面)→ Task 4 §2/§3、Task 5、Task 6、Task 7 ✓
- 搜索栏 + 歌曲搜索(SEARCH 入口聚焦 + type=song)→ Task 4、Task 6、Task 7 ✓
- 歌手搜索 + 下钻(type=artist + /api/artist/songs + ArtistRow + view 状态机)→ Task 3、Task 4、Task 5、Task 6 ✓
- 一页两用(空态推荐 / 输入即搜 / 清空复原)→ Task 6 ✓
- 点即播(mode=now 插当前之后)/ ⊕ 排队(mode=queue)→ Task 2、Task 4、Task 5/6 ✓
- 复用 playback-coordinator 取原唱(resolveById / resolvePlayList)→ Task 3、Task 4 ✓
- 不打断 DJ + play-event 由前端照常上报 → Task 4(playNow 插入而非清空)✓
- 错误处理(空池 / 无结果 / unplayable / 网络)→ Task 4(返回体)、Task 6(空态 + toast,英文短句)✓
- night-issue 一致性(token / Icon.vue / 英文 chrome / masthead 文字导航)→ Task 5、6、7 全程 + Task 7 Step 3 核对项 ✓
- v0.5 文档同步(播放行为变化)→ Task 8 Step 5 ✓
- 测试:归一化 + 队列 ops 单测;接口/前端集成与可视验证 → Task 1、2、4、7、8 ✓
- 非目标(专辑/歌单、刷新、抽屉方案)→ 未列入任务,符合 spec ✓
