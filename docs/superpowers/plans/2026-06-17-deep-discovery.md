# Deep Discovery + Honor-the-Dial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the DJ deep, direction-aware new-song discovery from NetEase (playlist-search + similar-artists + charts), make the exploration dial control adventurousness, make direction turns honor the dial, and stop silently dropping explicitly-named songs.

**Architecture:** A new `server/discovery.js` builds a candidate pool blending a "near" tier (existing simi-of-loved) and a "far" tier (NetEase playlist-search / similar-artists / charts), tiered by the dial and reranked by affinity. `context-builder` calls it in place of the bare explore pool. `align-batch` is changed to honor the familiar/new ratio under a direction. "第一首放 X" becomes a distinct pin intent.

**Tech Stack:** Node 20+ ESM, node:test, better-sqlite3, existing modules (`explore-pool`, `affinity`, `playlist-builder`, `align-batch`, `direction`, `ncm-client`).

---

## File structure

- **Modify** `server/ncm-client.js` — add `searchPlaylists`, `simiArtist`, `toplist` wrappers.
- **Create** `server/discovery.js` — `blendDiscovery` (pure) + `buildFarTier` + `buildDiscoveryPool` (I/O, injectable deps).
- **Create** `tests/discovery.test.js`.
- **Modify** `server/context-builder.js` — replace the bare `buildExplorePool` call with `buildDiscoveryPool`; cache per focus.
- **Modify** `server/align-batch.js` — run the ratio step under a direction; protect index 0 when pinned.
- **Modify** `server/direction.js` — split `detectPinnedFirst` out of `detectVerbatim`, fix the regex.
- **Modify** `server/queue-ops.js` — arrange/shuffle the chat queue (keep pinned first).
- **Modify** `server/index.js` — pass `pinnedFirst` through; retry+notice a dropped pinned song; use the arrange helper.
- **Modify** `server/playback-coordinator.js` — `resolveOne` retry helper (or reuse existing) for the pinned retry.
- **Modify** `nightliner-design-v0.5.md` + memory — doc sync.

---

## Task 1: NetEase discovery endpoint wrappers

**Files:**
- Modify: `server/ncm-client.js`

No unit test (thin network wrappers, verified by Task 3's faked tests + live check).

- [ ] **Step 1: Add the wrappers**

Append to `server/ncm-client.js` (after `personalFm`):

```js
// 歌单搜索(cloudsearch type=1000 → result.playlists)—— 题材/年代/语种发现的主力
export async function searchPlaylists(keywords, { limit = 8 } = {}) {
  return ncmRequest('/cloudsearch', { keywords, limit, type: 1000 });
}

// 相似艺人(/simi/artist → artists)—— 从「你爱的艺人」横向扩到「像他的艺人」
export async function simiArtist(id) {
  return ncmRequest('/simi/artist', { id });
}

// 排行榜列表(/toplist → list,每个是一张歌单 id,可再 playlistTrackAll 取曲)
export async function toplist() {
  return ncmRequest('/toplist');
}
```

- [ ] **Step 2: Syntax check + commit**

Run: `node --check server/ncm-client.js` (expect no output).
```bash
git add server/ncm-client.js
git commit -m "feat(ncm): searchPlaylists / simiArtist / toplist wrappers"
```

---

## Task 2: `blendDiscovery` (pure tier-blend + affinity rerank)

**Files:**
- Create: `server/discovery.js`
- Test: `tests/discovery.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/discovery.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendDiscovery } from '../server/discovery.js';
import { songKey } from '../server/explore-pool.js';

const near = [{ name: 'N1', artist: 'a' }, { name: 'N2', artist: 'b' }, { name: 'N3', artist: 'c' }];
const far = [{ name: 'F1', artist: 'x' }, { name: 'F2', artist: 'y' }, { name: 'F3', artist: 'z' }];
const mode = (v) => ({ value: v });
const emptyAff = new Map();

test('Comfort (value 0) → all near, no far', () => {
  const out = blendDiscovery({ near, far, mode: mode(0), limit: 3, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.equal(out.length, 3);
  assert.ok(out.every(c => c.name.startsWith('N')), 'only near-tier songs');
});

test('Wild (value 100) → all far', () => {
  const out = blendDiscovery({ near, far, mode: mode(100), limit: 3, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.ok(out.every(c => c.name.startsWith('F')), 'only far-tier songs');
});

test('libKeys + excludeKeys are filtered out', () => {
  const libKeys = new Set([songKey('N1', 'a')]);
  const excludeKeys = new Set([songKey('F1', 'x')]);
  const out = blendDiscovery({ near, far, mode: mode(50), limit: 6, libKeys, excludeKeys, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.ok(!out.some(c => c.name === 'N1'), 'library song excluded');
  assert.ok(!out.some(c => c.name === 'F1'), 'excluded song excluded');
});

test('cross-tier duplicate appears once', () => {
  const dup = [{ name: 'SAME', artist: 'a' }];
  const out = blendDiscovery({ near: dup, far: dup, mode: mode(50), limit: 6, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.equal(out.filter(c => c.name === 'SAME').length, 1);
});

test('affinity reranks loved songs up (deterministic rng)', () => {
  const songAff = new Map([[songKey('F3', 'z'), { loves: 50 }]]);
  const out = blendDiscovery({ near: [], far, mode: mode(100), limit: 3, songAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.equal(out[0].name, 'F3', 'loved far song ranks first');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --env-file=.env --test tests/discovery.test.js`
Expected: FAIL — cannot import `blendDiscovery`.

- [ ] **Step 3: Implement `blendDiscovery` in `server/discovery.js`**

```js
// server/discovery.js
// 发现层:把「近(像你爱的)」和「远(题材广度/榜单)」两路候选按探索档位混合,
// 用 affinity 重排到你的口味(Agency:绝不照搬网易云原序)。
import { songKey } from './explore-pool.js';
import { songWeight } from './affinity.js';

// 纯函数:混合 near/far,去重(库内/排除集/跨档),按 affinity*噪声 重排。
export function blendDiscovery({ near = [], far = [], mode, libKeys = new Set(), excludeKeys = new Set(), limit = 24, songAff, artistAff, rng = Math.random }) {
  const farFraction = (mode?.value ?? 50) / 100;
  const desiredFar = Math.round(limit * farFraction);
  const desiredNear = limit - desiredFar;
  const exclude = new Set([...libKeys, ...excludeKeys]);

  const dedup = (arr) => {
    const seen = new Set(); const out = [];
    for (const c of arr) {
      const k = songKey(c.name, c.artist);
      if (!c.name || exclude.has(k) || seen.has(k)) continue;
      seen.add(k); out.push(c);
    }
    return out;
  };
  const sortByW = (arr) => arr
    .map(c => ({ c, k: songWeight({ name: c.name, artist: c.artist }, { songAff, artistAff }) * (0.5 + rng()) }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.c);

  const nearD = sortByW(dedup(near));
  const farD = sortByW(dedup(far));

  const taken = new Set();
  const pick = (arr, n) => {
    const out = [];
    for (const c of arr) {
      if (out.length >= n) break;
      const k = songKey(c.name, c.artist);
      if (taken.has(k)) continue;
      taken.add(k); out.push(c);
    }
    return out;
  };

  let out = [...pick(nearD, desiredNear), ...pick(farD, desiredFar)];
  if (out.length < limit) out = [...out, ...pick([...nearD, ...farD], limit - out.length)];
  return out.slice(0, limit);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --env-file=.env --test tests/discovery.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/discovery.js tests/discovery.test.js
git commit -m "feat(dj): blendDiscovery — dial-tiered near/far blend + affinity rerank"
```

---

## Task 3: `buildFarTier` + `buildDiscoveryPool` (I/O, injectable)

**Files:**
- Modify: `server/discovery.js`
- Test: `tests/discovery.test.js` (append)

- [ ] **Step 1: Append the failing tests**

```js
import { buildFarTier } from '../server/discovery.js';

// fake ncm dependency object
function fakeNcm(over = {}) {
  return {
    searchPlaylists: async () => ({ result: { playlists: [{ id: 1, name: 'pl', playCount: 9 }] } }),
    playlistTrackAll: async () => ({ songs: [{ name: 'PlSong', ar: [{ name: 'PlArtist' }], id: 11 }] }),
    searchArtists: async () => ({ result: { artists: [{ id: 7, name: 'A' }] } }),
    simiArtist: async () => ({ artists: [{ id: 8, name: 'SimA' }] }),
    artistTopSongs: async () => ({ songs: [{ name: 'TopSong', ar: [{ name: 'SimA' }], id: 22 }] }),
    toplist: async () => ({ list: [] }),
    ...over,
  };
}

test('buildFarTier(direction) pulls playlist tracks', async () => {
  const dir = { langMatch: 'chinese', gender: null, artists: [], raw: '千禧华语' };
  const far = await buildFarTier({ direction: dir, lovedArtists: [] }, fakeNcm());
  assert.ok(far.some(c => c.name === 'PlSong'), 'playlist track present');
});

test('buildFarTier(open) uses similar-artists of loved', async () => {
  const far = await buildFarTier({ direction: null, lovedArtists: [{ name: 'A' }] }, fakeNcm());
  assert.ok(far.some(c => c.name === 'TopSong'), 'similar-artist top song present');
});

test('buildFarTier swallows NetEase failures (returns array)', async () => {
  const far = await buildFarTier({ direction: null, lovedArtists: [{ name: 'A' }] },
    fakeNcm({ searchArtists: async () => { throw new Error('502'); } }));
  assert.ok(Array.isArray(far));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --env-file=.env --test tests/discovery.test.js`
Expected: FAIL — `buildFarTier` not exported.

- [ ] **Step 3: Implement `buildFarTier` + `buildDiscoveryPool` in `server/discovery.js`**

Add imports at the top of `server/discovery.js`:

```js
import * as ncm from './ncm-client.js';
import { buildExplorePool } from './explore-pool.js';
import { songAffinity, artistAffinity } from './affinity.js';
import { directionQuery } from './direction.js';
```

Append:

```js
const norm = (s) => ({ name: s.name, artist: (s.ar || s.artists || []).map(a => a?.name).filter(Boolean).join(' / '), ncm_id: s.id, kind: 'discovery' });

// 远档候选:有方向 → 歌单搜索 + 榜单;无方向 → 爱的艺人的相似艺人热门曲。
// deps 可注入(测试用 fake ncm);默认用真实 ncm-client。
export async function buildFarTier({ direction, lovedArtists = [], playlistCap = 3, perPlaylist = 20 }, deps = ncm) {
  const out = [];
  try {
    if (direction) {
      const kw = directionQuery(direction);
      const res = await deps.searchPlaylists(kw, { limit: 8 });
      const pls = (res?.result?.playlists || []).sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, playlistCap);
      const tracks = await Promise.allSettled(pls.map(p => deps.playlistTrackAll(p.id, { limit: perPlaylist })));
      for (const t of tracks) if (t.status === 'fulfilled') for (const s of (t.value?.songs || [])) out.push(norm(s));
    } else {
      for (const a of lovedArtists.slice(0, 3)) {
        try {
          const ar = await deps.searchArtists(a.name, { limit: 1 });
          const id = ar?.result?.artists?.[0]?.id;
          if (!id) continue;
          const sim = await deps.simiArtist(id);
          const simIds = (sim?.artists || []).slice(0, 3).map(x => x.id);
          const tops = await Promise.allSettled(simIds.map(sid => deps.artistTopSongs(sid)));
          for (const t of tops) if (t.status === 'fulfilled') for (const s of (t.value?.songs || []).slice(0, 5)) out.push(norm(s));
        } catch { /* one artist failing is fine */ }
      }
    }
  } catch { /* far tier is best-effort */ }
  return out;
}

// 顶层编排:near(explore-pool)+ far(buildFarTier)→ blendDiscovery。
export async function buildDiscoveryPool({ direction, mode, lovedSeeds = [], lovedArtists = [], libKeys = new Set(), excludeKeys = new Set(), limit = 24, exploreParams = {} }) {
  const near = await buildExplorePool({ seeds: lovedSeeds, excludeKeys, ...exploreParams }).catch(() => []);
  const far = mode.value > 0 ? await buildFarTier({ direction, lovedArtists }) : [];
  return blendDiscovery({ near, far, mode, libKeys, excludeKeys, limit, songAff: songAffinity(), artistAff: artistAffinity() });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --env-file=.env --test tests/discovery.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/discovery.js tests/discovery.test.js
git commit -m "feat(dj): far-tier discovery (playlist-search / similar-artists) + orchestration"
```

---

## Task 4: Wire discovery into `context-builder`

**Files:**
- Modify: `server/context-builder.js`

No new unit test (IO-heavy; covered by Task 2/3 + live check).

- [ ] **Step 1: Add imports + a per-focus cache**

In `server/context-builder.js`, add:
```js
import { buildDiscoveryPool } from './discovery.js';
import { lovedSeeds, artistAffinity } from './affinity.js';
```
(If `lovedSeeds`/`artistAffinity` are already imported from `./affinity.js`, merge into that line.)

Add a module-level cache near the other caches:
```js
const _discoveryCache = new Map(); // focusKey → { ts, pool }
const DISCOVERY_TTL = 30 * 60 * 1000;
```

- [ ] **Step 2: Replace the explore-pool construction with discovery**

Find the block that builds `explorePool` via `buildExplorePool({ seeds, excludeKeys, perSeedCap, limit, deepCutArtists })`. Replace the `explorePool = await buildExplorePool(...)` assignment with a discovery call that reuses the same seeds/excludeKeys/mode params:

```js
      const focusKey = direction ? `dir:${directionQuery(direction)}|${mode.value}` : `open:${mode.value}`;
      const cached = _discoveryCache.get(focusKey);
      if (cached && Date.now() - cached.ts < DISCOVERY_TTL) {
        explorePool = cached.pool;
      } else {
        explorePool = await buildDiscoveryPool({
          direction, mode,
          lovedSeeds: lovedSeeds(6),
          lovedArtists: [...artistAffinity().values()].sort((a, b) => b.loves - a.loves).slice(0, 3),
          libKeys, excludeKeys, limit: 24,
          exploreParams: { perSeedCap: direction ? Math.max(mode.perSeedCap, 2) : mode.perSeedCap, limit: 14, deepCutArtists: direction ? Math.max(mode.deepCutArtists, 3) : mode.deepCutArtists },
        }).catch(e => { console.warn('[discovery] failed:', e.message); return []; });
        if (direction) explorePool = explorePool.filter(c => dirMatch(c.name, c.artist)); // far tier 也按方向过滤
        _discoveryCache.set(focusKey, { ts: Date.now(), pool: explorePool });
      }
```
Keep the surrounding `seeds`/`needExplore` logic that builds `lovedSeeds`-equivalent seeds; the discovery call now owns the near tier, so the old direct `buildExplorePool` assignment is replaced. Leave `meta.explorePool = explorePool` as-is.

- [ ] **Step 3: Syntax check + full suite**

Run: `node --check server/context-builder.js && npm test`
Expected: green (no regressions; discovery only changes the candidate source).

- [ ] **Step 4: Doc + commit**

In `nightliner-design-v0.5.md` §3.3, note that the wildcard/explore pool now comes from `discovery.js` (near simi-of-loved + far playlist-search/similar-artists/charts, blended by dial, affinity-reranked, 30-min cache per focus).

```bash
git add server/context-builder.js nightliner-design-v0.5.md
git commit -m "feat(dj): context-builder sources explore pool from discovery layer"
```

---

## Task 5: Honor the dial under a direction (`align-batch`)

**Files:**
- Modify: `server/align-batch.js`
- Test: `tests/align-batch.test.js` (append)

- [ ] **Step 1: Append the failing test**

```js
test('direction turn now aligns familiar/new ratio (swaps to in-direction new)', () => {
  const lib = [{ name: '库A', artist: '甲' }, { name: '库B', artist: '乙' }];
  const dir = { langMatch: 'chinese', gender: null, artists: [], raw: '国语' };
  // model returned 3 library Chinese songs; venture wants mostly new
  const plays = [
    { title: '库A', artist: '甲', source_pool: 'library' },
    { title: '库B', artist: '乙', source_pool: 'library' },
    { title: '库C', artist: '丙', source_pool: 'library' },
  ];
  const meta = {
    famTarget: 1, direction: dir,
    libKeys: new Set(lib.map(s => songKey(s.name, s.artist)).concat([songKey('库C', '丙')])),
    librarySlice: [], recommendPool: [],
    // in-direction NEW candidate available:
    explorePool: [{ name: '新中文', artist: '丁', ncm_id: 9 }],
  };
  const r = repairFamiliarNew(plays, meta);
  assert.ok(r.repaired >= 1, 'ratio ran under direction');
  assert.ok(plays.some(p => p.title === '新中文'), 'pulled an in-direction new song');
});
```
(Assumes `新中文 / 丁` is treated as chinese by `songMatchesDirection` — Han title → chinese, so it matches.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --env-file=.env --test tests/align-batch.test.js`
Expected: FAIL — `repaired` is 0 (step 2 skipped under direction today).

- [ ] **Step 3: Change the step-2 guard in `server/align-batch.js`**

Find:
```js
  let familiar = plays.filter(inLib).length;
  if (!direction && !verbatim) {
```
Replace the condition with:
```js
  let familiar = plays.filter(inLib).length;
  if (!verbatim) {   // 现在方向 turn 也对齐:用方向内候选拉「全新」,尊重探索档位(不再「方向 turn 失效」)
```
(The candidate lists `newCands`/`libCands` are already direction-filtered via `matchesDir`, so under a direction this only ever swaps in in-direction songs — never off-direction padding.)

- [ ] **Step 4: Run to verify it passes + full suite**

Run: `node --env-file=.env --test tests/align-batch.test.js && npm test`
Expected: PASS; pre-existing align tests still green.

- [ ] **Step 5: Commit**

```bash
git add server/align-batch.js tests/align-batch.test.js
git commit -m "feat(dj): direction turns honor the exploration dial (in-direction new)"
```

---

## Task 6: Split `detectPinnedFirst` from `detectVerbatim`

**Files:**
- Modify: `server/direction.js`
- Test: `tests/direction.test.js` (append)

- [ ] **Step 1: Append the failing test**

```js
import { detectPinnedFirst } from '../server/direction.js';

test('detectPinnedFirst catches natural phrasings', () => {
  for (const m of ['第一首放偏爱', '第一首我要听偏爱', '第一首歌要偏爱', '第一首是偏爱', '第一首先放 X']) {
    assert.equal(detectPinnedFirst(m), true, m);
  }
});
test('detectPinnedFirst does not fire on plain requests', () => {
  for (const m of ['来一批千禧华语', '换一批', '放点国语女声']) {
    assert.equal(detectPinnedFirst(m), false, m);
  }
});
test('detectVerbatim now only fires on 直接/原样, not 第一首', () => {
  assert.equal(detectVerbatim('直接放每日推荐'), true);
  assert.equal(detectVerbatim('第一首放偏爱'), false); // 现在归 detectPinnedFirst
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --env-file=.env --test tests/direction.test.js`
Expected: FAIL — `detectPinnedFirst` not exported, and `detectVerbatim('第一首放偏爱')` still true.

- [ ] **Step 3: Edit `server/direction.js`**

Remove the `PIN_FIRST` branch from `detectVerbatim`. The current code is:
```js
const VERBATIM_CUE = /(直接|原样|按顺序|按原顺序|原封|完整|别筛|别动|照着|照原)/;
const PIN_FIRST = /第一首\s*(放|要|是|来|播|给|用|先|得|换成)/;
export function detectVerbatim(message) {
  const m = message || '';
  if (PIN_FIRST.test(m)) return true;
  if (/每日推荐/.test(m) && VERBATIM_CUE.test(m)) return true;
  return false;
}
```
Replace it with:
```js
const VERBATIM_CUE = /(直接|原样|按顺序|按原顺序|原封|完整|别筛|别动|照着|照原)/;
export function detectVerbatim(message) {
  const m = message || '';
  return /每日推荐/.test(m) && VERBATIM_CUE.test(m);
}

// 点名头部:"第一首(歌/我要)?(放|要|是|听|来|播…) X" —— 容忍中间的「歌/我/我要」等字。
const PIN_FIRST = /第一首[歌曲]?\s*(我?要听|我要|放|要|是|听|来|播|给|用|先|得|换成)/;
export function detectPinnedFirst(message) {
  return PIN_FIRST.test(message || '');
}
```

- [ ] **Step 4: Run to verify it passes + full suite**

Run: `node --env-file=.env --test tests/direction.test.js && npm test`
Expected: PASS. (Note: a turn that is BOTH a direction and a pin still detects both — fine.)

- [ ] **Step 5: Commit**

```bash
git add server/direction.js tests/direction.test.js
git commit -m "feat(dj): detectPinnedFirst split from verbatim, tolerant pin regex"
```

---

## Task 7: Protect the pinned first song in `align-batch`

**Files:**
- Modify: `server/align-batch.js`, `server/context-builder.js`, `server/index.js`
- Test: `tests/align-batch.test.js` (append)

- [ ] **Step 1: Append the failing test**

```js
test('pinnedFirst keeps play[0] while aligning the rest', () => {
  const dir = null;
  const plays = [
    { title: 'PINNED', artist: 'p', source_pool: 'wildcard' },     // index 0, not in lib
    { title: '库A', artist: '甲', source_pool: 'library' },
    { title: '库B', artist: '乙', source_pool: 'library' },
  ];
  const meta = {
    famTarget: 0, direction: null, pinnedFirst: true,
    libKeys: new Set([songKey('库A', '甲'), songKey('库B', '乙')]),
    librarySlice: [], recommendPool: [],
    explorePool: [{ name: 'NEW1', artist: 'n', ncm_id: 1 }, { name: 'NEW2', artist: 'm', ncm_id: 2 }],
  };
  repairFamiliarNew(plays, meta);
  assert.equal(plays[0].title, 'PINNED', 'pinned head untouched');
  assert.ok(plays.slice(1).some(p => p.title.startsWith('NEW')), 'the rest still got aligned to new');
});
```

This is meaningful because famTarget is 0 and 库A/库B are in-library, so step 2's `familiar > famTarget` loop swaps library→new. Without `pinnedFirst` handling, the index-0 `findIndex(inLib)` path leaves PINNED alone *anyway* (it's not in-lib), so the first assertion alone is weak — the second assertion (the tail got aligned) is what proves step 2 ran. The real protection matters when play[0] IS a library song; see the alternate case below.

Add a second test where the pinned head IS a library song (the case that needs protection):
```js
test('pinnedFirst protects play[0] even when it is a library song', () => {
  const plays = [
    { title: '库A', artist: '甲', source_pool: 'library' }, // pinned, in lib
    { title: '库B', artist: '乙', source_pool: 'library' },
    { title: '库C', artist: '丙', source_pool: 'library' },
  ];
  const meta = {
    famTarget: 0, direction: null, pinnedFirst: true,
    libKeys: new Set([songKey('库A', '甲'), songKey('库B', '乙'), songKey('库C', '丙')]),
    librarySlice: [], recommendPool: [],
    explorePool: [{ name: 'NEW1', artist: 'n', ncm_id: 1 }, { name: 'NEW2', artist: 'm', ncm_id: 2 }],
  };
  repairFamiliarNew(plays, meta);
  assert.equal(plays[0].title, '库A', 'library pinned head is NOT swapped out');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --env-file=.env --test tests/align-batch.test.js`
Expected: FAIL — the second test fails: with `famTarget 0`, step 2 swaps library→new starting at `findIndex(inLib)` = index 0, replacing 库A. Once `pinnedFirst` protection lands, index 0 is skipped.

- [ ] **Step 3: Implement pinned protection in `server/align-batch.js`**

Destructure `pinnedFirst` from meta:
```js
  const { famTarget, libKeys, librarySlice = [], explorePool = [], recommendPool = [], direction = null, verbatim = false, pinnedFirst = false } = meta || {};
```
In the step-2 loops that swap by index, skip index 0 when pinned. Change the two `findIndex` calls:
```js
    // 库内太多 → 把多出来的库内歌换成全新候选(pinnedFirst 时别动 index 0)
    while (familiar > famTarget && newCands.length) {
      const idx = plays.findIndex((p, i) => (!pinnedFirst || i > 0) && inLib(p));
      if (idx < 0) break;
      ...
    }
    // 库内太少 → 把多出来的全新歌换成库内候选(pinnedFirst 时别动 index 0)
    while (familiar < famTarget && libCands.length) {
      const idx = plays.findIndex((p, i) => (!pinnedFirst || i > 0) && !inLib(p));
      if (idx < 0) break;
      ...
    }
```

- [ ] **Step 4: Thread `pinnedFirst` through to meta**

In `server/index.js`, where `detectVerbatim` is computed, also compute pinnedFirst and pass it to `buildChatMessages`:
```js
    const verbatim = detectVerbatim(message);
    const pinnedFirst = detectPinnedFirst(message);
    if (pinnedFirst) console.log('[chat] pinnedFirst 指令 → 保护 play[0],其余按档位对齐');
```
Add `detectPinnedFirst` to the `./direction.js` import. Pass `pinnedFirst` into `buildChatMessages({ ..., verbatim, pinnedFirst })`.

In `server/context-builder.js`, add `pinnedFirst = false` to the `buildChatMessages` destructured params and add `pinnedFirst` to the returned `meta` object (next to `verbatim`).

- [ ] **Step 5: Run + full suite**

Run: `node --check server/index.js && node --check server/context-builder.js && node --env-file=.env --test tests/align-batch.test.js && npm test`
Expected: PASS, all green.

- [ ] **Step 6: Commit**

```bash
git add server/align-batch.js server/context-builder.js server/index.js tests/align-batch.test.js
git commit -m "feat(dj): pinnedFirst protects play[0] while aligning the rest"
```

---

## Task 8: Don't silently drop a pinned song + shuffle the chat queue

**Files:**
- Modify: `server/queue-ops.js`, `server/index.js`
- Test: `tests/queue-ops.test.js` (append)

- [ ] **Step 1: Append the failing test**

```js
import { arrangeQueue } from '../server/queue-ops.js';

test('arrangeQueue shuffles but keeps the pinned song first', () => {
  const q = [];
  for (let i = 0; i < 8; i++) q.push(s({ ncm_id: i, title: 'T' + i }));
  const out = arrangeQueue(q, { pinnedFirst: true, rng: () => 0 });
  assert.equal(out[0].ncm_id, 0, 'pinned (first) song stays at front');
  assert.equal(out.length, 8);
});
test('arrangeQueue without pinnedFirst shuffles all (pure, no input mutation)', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const out = arrangeQueue(q, { pinnedFirst: false, rng: () => 0 });
  assert.equal(out.length, 3);
  assert.equal(q.length, 3); // input untouched
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --env-file=.env --test tests/queue-ops.test.js`
Expected: FAIL — `arrangeQueue` not exported.

- [ ] **Step 3: Implement `arrangeQueue` in `server/queue-ops.js`**

```js
// 给 chat 推荐队列排序:整体打散(避免「前面全是听过的」);pinnedFirst 时保住头部那首。
export function arrangeQueue(playable, { pinnedFirst = false, rng = Math.random } = {}) {
  const arr = [...playable];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  if (pinnedFirst && arr.length > 1) return [arr[0], ...shuffle(arr.slice(1))];
  return shuffle(arr);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --env-file=.env --test tests/queue-ops.test.js`
Expected: PASS.

- [ ] **Step 5: Wire arrange + pinned-drop notice into `server/index.js`**

In the `intent === 'recommend'` branch of `/api/chat`, after `const playable = resolved.filter(s => s.found);` and BEFORE `applyChatRecommendation`:

```js
      // 显式点名的第一首没解析出来(常是网易云瞬时 502)→ 别静默丢,告诉用户
      if (pinnedFirst && plays.length) {
        const want = plays[0];
        const got = playable.some(s => s.title === want.title);
        if (!got) {
          broadcast({ type: 'dj_message', data: { ts, kind: 'system',
            text: `「${want.title}」这次没找到能播的版本(可能网络抖动),其余照常。` } });
          console.warn(`[chat] pinnedFirst "${want.title}" 未能解析,已提示用户`);
        }
      }
      const arranged = arrangeQueue(playable, { pinnedFirst });
```
Then change the `applyChatRecommendation(currentQueue, now, playable, parsed.queueAction)` call to pass `arranged` instead of `playable`. Add `arrangeQueue` to the `./queue-ops.js` import.

- [ ] **Step 6: Syntax + full suite**

Run: `node --check server/index.js && npm test`
Expected: green.

- [ ] **Step 7: Doc + memory + commit**

In `nightliner-design-v0.5.md` §3.2/§3.4: note direction turns now honor the dial (reverses "方向 turn 不再硬对齐"); pinnedFirst protects play[0]; explicit songs that fail to resolve get a notice; chat queue is shuffled. Update the memory file `project_direction_hard_constraint.md` line about "方向 turn 不再硬对齐 familiar/new 比例" to reflect the reversal.

```bash
git add server/queue-ops.js server/index.js tests/queue-ops.test.js nightliner-design-v0.5.md
git commit -m "feat(dj): shuffle chat queue + notice when a pinned song can't resolve"
```

---

## Self-review notes

- **Spec coverage:** discovery sources (T1–T3), all-turns scope (T4 handles direction + open focus), dial-controls-adventurousness (T2 blend by mode.value), Agency rerank (T2 affinity), honor-the-dial under direction (T5), pinned split + regex (T6), pinned protect (T7), pinned-drop notice + shuffle (T8), caching (T4). All covered.
- **Type consistency:** `blendDiscovery({near,far,mode,libKeys,excludeKeys,limit,songAff,artistAff,rng})`, `buildFarTier({direction,lovedArtists},deps)`, `buildDiscoveryPool({direction,mode,lovedSeeds,lovedArtists,libKeys,excludeKeys,limit,exploreParams})`, `arrangeQueue(playable,{pinnedFirst,rng})`, `detectPinnedFirst(message)`, `meta.pinnedFirst` — consistent across tasks.
- **Network boundary:** `buildFarTier` takes injectable `deps` (default real ncm) so Task 3 tests with fakes; `searchPlaylists`/`simiArtist`/`toplist` wrappers (T1) are the only untested network code, exercised by the live check.
- **Deferred (spec non-goals):** web search; `toplist` is wired (T1) but used lightly — far tier leans on playlist-search/similar-artists first, charts as a later booster.
- **Live check (after merge):** isolated `:8099` — "千禧华语 venture" yields mostly new in-direction songs; "第一首我要听 X" keeps X first; an unresolvable pinned song shows a notice.
```
