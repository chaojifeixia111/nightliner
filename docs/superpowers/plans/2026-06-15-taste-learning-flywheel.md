# Taste-Learning Flywheel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent converge on Elliot's taste by deriving a durable affinity store from feedback and feeding it into BOTH the chat and Listen (venture/wild) recommendation paths.

**Architecture:** A new `server/affinity.js` derives affinity (love counts per song/artist, negatives, loved seeds, graduated library, a live-taste prompt block) on-read from the existing `feedback` table — no second source of truth. The Listen path weights selection by affinity, unions graduated loves into the library, excludes wrong_vibe/cooldown, and seeds exploration from loves. The chat path prioritizes loved songs, injects a live-taste block, and drops skip-based demotion. `love` becomes cumulative + durable; `wrong_vibe` becomes a real negative; `skip` stops penalizing.

**Tech Stack:** Node 20+ ESM, better-sqlite3, node:test, existing modules (`explore-pool.js`, `playlist-builder.js`, `context-builder.js`).

---

## File structure

- **Create** `server/affinity.js` — all affinity derivation (one responsibility: turn feedback into preference signals).
- **Create** `tests/affinity.test.js`, `tests/feedback-store.test.js`.
- **Modify** `server/state-db.js` — add `feedback.ncm_id`; persist it; remove `staleLoves`/`skipStats`.
- **Modify** `server/explore-pool.js` — export `norm` (reuse in affinity).
- **Modify** `server/playlist-builder.js` — add `weightedOrder` + optional `weightOf` for affinity-weighted sampling.
- **Modify** `server/index.js` — `/api/feedback` captures ncm_id; `/api/listen` wires affinity.
- **Modify** `server/context-builder.js` — affinity-prioritized slice/seeds, live-taste block, drop demotion, wrong_vibe negative.
- **Modify** `prompts/user-turn.md` — add `{{LIVE_TASTE}}`, repurpose `{{DEMOTED}}` → wrong_vibe.
- **Create** `scripts/backfill-feedback-ncmid.js` — one-shot id backfill for existing loves.
- **Modify** `nightliner-design-v0.5.md` — doc sync.

---

## Task 1: Persist `ncm_id` on feedback

**Files:**
- Modify: `server/state-db.js` (feedback CREATE TABLE; migrate ALTER; `recordFeedback`)
- Modify: `server/index.js` (`POST /api/feedback` handler ~line 409)
- Test: `tests/feedback-store.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/feedback-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import db, { recordFeedback } from '../server/state-db.js';

test('recordFeedback persists ncm_id', () => {
  db.exec("DELETE FROM feedback;");
  recordFeedback({ song_title: 'Run Free', song_artist: 'Deep Chills / IVIE', signal: 'love', ncm_id: 123456 });
  const row = db.prepare("SELECT ncm_id FROM feedback WHERE song_title='Run Free'").get();
  assert.equal(row.ncm_id, 123456);
});

test('feedback table has ncm_id column', () => {
  const cols = db.prepare("PRAGMA table_info(feedback)").all().map(c => c.name);
  assert.ok(cols.includes('ncm_id'), 'feedback.ncm_id column exists');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --env-file=.env --test tests/feedback-store.test.js`
Expected: FAIL — column `ncm_id` does not exist / row.ncm_id undefined.

- [ ] **Step 3: Add the column + persist it**

In `server/state-db.js`, in the `feedback` CREATE TABLE add the column:

```js
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      song_title TEXT NOT NULL,
      song_artist TEXT NOT NULL,
      signal TEXT NOT NULL,
      ncm_id INTEGER,
      context_json TEXT
    );
```

At the end of `migrate(db)` (after the `db.exec(...)` block, before the closing brace), add the idempotent ALTER for existing DBs:

```js
  // idempotent column add for pre-existing DBs (CREATE TABLE only runs on fresh DBs)
  const fbCols = db.prepare(`PRAGMA table_info(feedback)`).all();
  if (!fbCols.some(c => c.name === 'ncm_id')) {
    db.exec(`ALTER TABLE feedback ADD COLUMN ncm_id INTEGER`);
  }
```

In `recordFeedback`, update the INSERT to include `ncm_id`:

```js
  db.prepare(`
    INSERT INTO feedback (ts, song_title, song_artist, signal, ncm_id, context_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    Math.floor(Date.now() / 1000),
    fb.song_title,
    fb.song_artist,
    fb.signal,
    fb.ncm_id ?? null,
    fb.context_json ? JSON.stringify(fb.context_json) : null
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --env-file=.env --test tests/feedback-store.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Capture ncm_id at the API boundary**

In `server/index.js` `POST /api/feedback` handler, change destructure + call:

```js
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
```

(The frontend already sends `ncm_id` — `pwa/src/ws-client.js:69`.)

- [ ] **Step 6: Run full suite + commit**

Run: `npm test` → expect all green.
```bash
git add server/state-db.js server/index.js tests/feedback-store.test.js
git commit -m "feat(dj): persist ncm_id on feedback (enables loved-song graduation)"
git push
```

---

## Task 2: `server/affinity.js` core

**Files:**
- Modify: `server/explore-pool.js` (export `norm`)
- Create: `server/affinity.js`
- Test: `tests/affinity.test.js`

- [ ] **Step 1: Export `norm` from explore-pool.js**

In `server/explore-pool.js` change `function norm(s)` to `export function norm(s)`.

- [ ] **Step 2: Write the failing test**

```js
// tests/affinity.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/state-db.js';
import { songWeight, artistAffinity, lovedSeeds, graduatedLibrary, negativeKeys, negativeSongs } from '../server/affinity.js';
import { songKey } from '../server/explore-pool.js';

function reset() { db.exec("DELETE FROM feedback; DELETE FROM cooldown; DELETE FROM anti_list;"); }
function fb(signal, title, artist, ncm_id) {
  db.prepare("INSERT INTO feedback (ts,song_title,song_artist,signal,ncm_id) VALUES (?,?,?,?,?)")
    .run(Math.floor(Date.now() / 1000), title, artist, signal, ncm_id ?? null);
}

test('songWeight grows with cumulative loves', () => {
  reset();
  fb('love', 'A', 'X', 1); fb('love', 'A', 'X', 1);
  const w2 = songWeight({ name: 'A', artist: 'X' });
  fb('love', 'A', 'X', 1);
  const w3 = songWeight({ name: 'A', artist: 'X' });
  assert.ok(w3 > w2, 'more loves => more weight');
  assert.ok(songWeight({ name: 'Z', artist: 'Q' }) === 1, 'unloved baseline = 1');
});

test('artistAffinity sums loves across an artist', () => {
  reset();
  fb('love', 'A', 'X', 1); fb('love', 'B', 'X', 2); fb('love', 'C', 'Y', 3);
  const a = artistAffinity();
  assert.equal(a.get('x').loves, 2);
  assert.equal(a.get('y').loves, 1);
});

test('lovedSeeds only returns loves with ncm_id', () => {
  reset();
  fb('love', 'WithId', 'X', 99);
  fb('love', 'NoId', 'Y', null);
  const seeds = lovedSeeds(10);
  assert.ok(seeds.some(s => s.ncm_id === 99));
  assert.ok(!seeds.some(s => s.name === 'NoId'));
});

test('graduatedLibrary = loved (with id) not already in library', () => {
  reset();
  fb('love', 'NewSong', 'X', 50);
  fb('love', 'OldSong', 'Y', 60);
  const libKeys = new Set([songKey('OldSong', 'Y')]);
  const grad = graduatedLibrary(libKeys);
  assert.ok(grad.some(s => s.name === 'NewSong'));
  assert.ok(!grad.some(s => s.name === 'OldSong'));
});

test('negativeKeys/negativeSongs include wrong_vibe + cooldown, not love', () => {
  reset();
  fb('love', 'Loved', 'X', 1);
  fb('wrong_vibe', 'Hated', 'Z', null);
  const keys = negativeKeys();
  assert.ok(keys.has(songKey('Hated', 'Z')));
  assert.ok(!keys.has(songKey('Loved', 'X')));
  assert.ok(negativeSongs().some(s => s.song_title === 'Hated'));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --env-file=.env --test tests/affinity.test.js`
Expected: FAIL — cannot import from `../server/affinity.js` (module missing).

- [ ] **Step 4: Implement `server/affinity.js`**

```js
// server/affinity.js
// Durable taste/affinity derived ON-READ from the feedback table (single source of truth).
// love = cumulative + durable (no time decay — Elliot only loves current taste).
// wrong_vibe = negative; cooldown(too_familiar) = temporary negative; skip = NOT used here.
import db, { activeCooldowns } from './state-db.js';
import { songKey, norm } from './explore-pool.js';

const mArtist = (artist) => norm((artist || '').split('/')[0]);

export function songAffinity() {
  const rows = db.prepare(`
    SELECT song_title name, song_artist artist, COUNT(*) loves, MAX(ncm_id) ncm_id, MAX(ts) lastTs
    FROM feedback WHERE signal='love'
    GROUP BY song_title, song_artist
  `).all();
  const m = new Map();
  for (const r of rows) m.set(songKey(r.name, r.artist), r);
  return m;
}

export function artistAffinity() {
  const rows = db.prepare(`SELECT song_artist artist, COUNT(*) loves FROM feedback WHERE signal='love' GROUP BY song_artist`).all();
  const m = new Map();
  for (const r of rows) {
    const k = mArtist(r.artist);
    if (!k) continue;
    const cur = m.get(k) || { loves: 0, name: (r.artist || '').split('/')[0].trim() };
    cur.loves += r.loves;
    m.set(k, cur);
  }
  return m;
}

// Weight for a candidate song. Base 1 so unloved songs still appear; loves stack.
export function songWeight(song, ctx) {
  const songAff = ctx?.songAff || songAffinity();
  const artistAff = ctx?.artistAff || artistAffinity();
  const s = songAff.get(songKey(song.name || song.title, song.artist));
  const a = artistAff.get(mArtist(song.artist));
  return 1 + (s?.loves || 0) + 0.5 * (a?.loves || 0);
}

export function lovedSeeds(limit = 6) {
  return db.prepare(`
    SELECT song_title name, song_artist artist, MAX(ncm_id) ncm_id, COUNT(*) loves, MAX(ts) lastTs
    FROM feedback WHERE signal='love' AND ncm_id IS NOT NULL
    GROUP BY song_title, song_artist
    ORDER BY lastTs DESC, loves DESC
  `).all().slice(0, limit).map(r => ({ ncm_id: r.ncm_id, name: r.name, artist: r.artist }));
}

export function graduatedLibrary(libKeySet) {
  return db.prepare(`
    SELECT song_title name, song_artist artist, MAX(ncm_id) ncm_id
    FROM feedback WHERE signal='love' AND ncm_id IS NOT NULL
    GROUP BY song_title, song_artist
  `).all().filter(r => !libKeySet.has(songKey(r.name, r.artist)))
    .map(r => ({ ncm_id: r.ncm_id, name: r.name, artist: r.artist }));
}

// wrong_vibe songs + active cooldown songs as a Set of songKey.
export function negativeKeys() {
  const keys = new Set();
  for (const r of negativeSongs()) keys.add(songKey(r.song_title, r.song_artist));
  return keys;
}

// raw negatives (so callers can re-key with their own normalizer, e.g. plKey).
export function negativeSongs() {
  const out = db.prepare(`SELECT song_title, song_artist FROM feedback WHERE signal='wrong_vibe'`).all();
  for (const c of activeCooldowns()) out.push({ song_title: c.song_title, song_artist: c.song_artist });
  return out;
}

export function wrongVibeSongs() {
  return db.prepare(`SELECT song_title, song_artist FROM feedback WHERE signal='wrong_vibe'`).all();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --env-file=.env --test tests/affinity.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit**

```bash
git add server/affinity.js server/explore-pool.js tests/affinity.test.js
git commit -m "feat(dj): affinity store derived from feedback (love/wrong_vibe/cooldown)"
git push
```

---

## Task 3: live-taste prompt block

**Files:**
- Modify: `server/affinity.js` (add `liveTasteBlock`)
- Test: `tests/affinity.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```js
import { liveTasteBlock } from '../server/affinity.js';

test('liveTasteBlock names top loved artists and recent loves', () => {
  db.exec("DELETE FROM feedback;");
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO feedback (ts,song_title,song_artist,signal) VALUES (?,?,?,?)")
    .run(Math.floor(Date.now() / 1000), 'S' + i, '徐佳莹', 'love');
  db.prepare("INSERT INTO feedback (ts,song_title,song_artist,signal) VALUES (?,?,?,?)")
    .run(Math.floor(Date.now() / 1000), 'Run Free', 'Deep Chills', 'love');
  const block = liveTasteBlock();
  assert.match(block, /徐佳莹/);
  assert.match(block, /Run Free/);
});

test('liveTasteBlock is graceful when empty', () => {
  db.exec("DELETE FROM feedback;");
  assert.equal(typeof liveTasteBlock(), 'string');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --env-file=.env --test tests/affinity.test.js`
Expected: FAIL — `liveTasteBlock` not exported.

- [ ] **Step 3: Implement `liveTasteBlock` in `server/affinity.js`**

```js
// Deterministic "current taste" view for the prompt (replaces never-built LLM consolidation).
export function liveTasteBlock() {
  const artists = [...artistAffinity().values()].sort((a, b) => b.loves - a.loves).slice(0, 8);
  const recent = db.prepare(`
    SELECT song_title, song_artist, COUNT(*) loves, MAX(ts) lastTs
    FROM feedback WHERE signal='love'
    GROUP BY song_title, song_artist ORDER BY lastTs DESC LIMIT 12
  `).all();
  if (!artists.length && !recent.length) return '(还没有 love 反馈积累 —— 暂以静态档案为准)';
  const artistLine = artists.length
    ? '最常 love 的艺人:' + artists.map(a => `${a.name}${a.loves > 1 ? `(${a.loves})` : ''}`).join('、')
    : '';
  const songLine = recent.length
    ? '最近 love 的歌:' + recent.map(r => `${r.song_title} / ${r.song_artist}`).join(' · ')
    : '';
  return [artistLine, songLine].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --env-file=.env --test tests/affinity.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/affinity.js tests/affinity.test.js
git commit -m "feat(dj): liveTasteBlock — deterministic current-taste view for the prompt"
git push
```

---

## Task 4: affinity-weighted sampling in the playlist builder

**Files:**
- Modify: `server/playlist-builder.js`
- Test: `tests/playlist-builder.test.js` (append)

- [ ] **Step 1: Write the failing test (append)**

```js
import { weightedOrder, buildPlaylist } from '../server/playlist-builder.js';

test('weightedOrder ranks higher-weight items first (constant rng)', () => {
  const items = [{ id: 'a', w: 1 }, { id: 'b', w: 4 }, { id: 'c', w: 100 }];
  const order = weightedOrder(items, it => it.w, () => 0.5);
  assert.deepEqual(order.map(x => x.id), ['c', 'b', 'a']);
});

test('buildPlaylist weightOf favors high-affinity songs', () => {
  const lib = [];
  for (let i = 0; i < 10; i++) lib.push({ name: 'L' + i, artist: 'a', ncm_id: i });
  const loved = { name: 'L7', artist: 'a' };
  const out = buildPlaylist({
    value: 0, n: 3, pools: { library: lib },
    weightOf: (s) => (s.name === 'L7' ? 1000 : 1),
    rng: () => 0.5,
  });
  assert.ok(out.some(s => s.name === 'L7'), 'heavily-weighted song is selected');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --env-file=.env --test tests/playlist-builder.test.js`
Expected: FAIL — `weightedOrder` not exported / `weightOf` ignored.

- [ ] **Step 3: Implement in `server/playlist-builder.js`**

Add the export and route `takeFrom` through it. Replace the `shuffle`/`takeFrom`/`buildPlaylist` signature region:

```js
// Efraimidis–Spirakis weighted sampling without replacement.
// weightOf(item) >= 0; with equal weights this reduces to a uniform shuffle.
export function weightedOrder(items, weightOf, rng = Math.random) {
  return items
    .map(it => ({ it, k: Math.pow(rng(), 1 / Math.max(weightOf(it), 1e-6)) }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.it);
}

function takeFrom(pool, want, used, exclude, rng, weightOf) {
  const picked = [];
  if (want <= 0) return picked;
  for (const s of weightedOrder(pool, weightOf, rng)) {
    if (picked.length >= want) break;
    const k = plKey(s);
    if (used.has(k) || exclude.has(k)) continue;
    used.add(k);
    picked.push(s);
  }
  return picked;
}

export function buildPlaylist({ value, n = 25, pools = {}, excludeKeys = new Set(), rng = Math.random, weightOf = () => 1 } = {}) {
  const mode = modeForValue(value);
  const lib = pools.library || [];
  const rec = pools.recommend || [];
  const wild = pools.wildcard || [];

  const used = new Set();
  const libN = Math.round((mode.lib / 100) * n);
  const recN = Math.round((mode.rec / 100) * n);
  const wildN = Math.max(0, n - libN - recN);

  const out = [
    ...takeFrom(lib, libN, used, excludeKeys, rng, weightOf),
    ...takeFrom(rec, recN, used, excludeKeys, rng, weightOf),
    ...takeFrom(wild, wildN, used, excludeKeys, rng, weightOf),
  ];

  if (out.length < n) {
    for (const s of weightedOrder([...lib, ...rec, ...wild], weightOf, rng)) {
      if (out.length >= n) break;
      const k = plKey(s);
      if (used.has(k) || excludeKeys.has(k)) continue;
      used.add(k);
      out.push(s);
    }
  }
  return shuffle(out, rng);  // final presentation shuffle stays uniform
}
```

(Keep the existing `shuffle` function — it's still used for the final pass.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --env-file=.env --test tests/playlist-builder.test.js`
Expected: PASS — including the pre-existing tests (default `weightOf` keeps uniform behavior).

- [ ] **Step 5: Commit**

```bash
git add server/playlist-builder.js tests/playlist-builder.test.js
git commit -m "feat(dj): affinity-weighted sampling in playlist builder (weightOf)"
git push
```

---

## Task 5: wire affinity into the Listen path (venture/wild — Elliot's main surface)

**Files:**
- Modify: `server/index.js` (`/api/listen` handler, the `level in LEVEL_VALUE` branch; add imports)

No new unit test (Express handler with NCM + DB IO; its logic is covered by Task 2/4 unit tests). Verified by the live check at the end.

- [ ] **Step 1: Add imports**

In `server/index.js` near the other server imports, add:

```js
import { songKey } from './explore-pool.js';
import { songAffinity, artistAffinity, songWeight, lovedSeeds, graduatedLibrary, negativeSongs } from './affinity.js';
```

- [ ] **Step 2: Rewrite the `level in LEVEL_VALUE` branch**

Replace the body of `else if (level in LEVEL_VALUE) { ... }` in `/api/listen` with:

```js
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
      for (const n2 of negativeSongs()) excludeKeys.add(plKey({ name: n2.song_title, artist: n2.song_artist })); // wrong_vibe + cooldown
      const songAff = songAffinity(), artistAff = artistAffinity();
      const weightOf = (s) => songWeight(s, { songAff, artistAff });
      songs = buildPlaylist({ value: LEVEL_VALUE[level], n, pools: { library: fullLibrary, recommend, wildcard }, excludeKeys, weightOf });
    } else {
```

- [ ] **Step 3: Syntax check + full suite**

Run: `node --check server/index.js && npm test`
Expected: syntax OK; all green.

- [ ] **Step 4: Live check (isolated instance)**

```bash
node -e "const D=require('better-sqlite3');new D('data/state.db',{readonly:true}).backup('data/_t.db').then(()=>process.exit(0))"
PORT=8099 NIGHTLINER_DB=data/_t.db node --env-file=.env server/index.js   # background
# then: POST /api/feedback {title,artist,signal:'love',ncm_id} for a test song,
# POST /api/listen {level:'venture'}, GET /api/queue — confirm loved song/artist surfaces.
```
Tear down: kill the :8099 process, `rm data/_t.db*`.

- [ ] **Step 5: Doc + commit**

Update `nightliner-design-v0.5.md` §六/§3: note `/api/listen` now unions graduated loves, weights by affinity, excludes wrong_vibe + cooldown, seeds explore from loves.

```bash
git add server/index.js nightliner-design-v0.5.md
git commit -m "feat(dj): Listen path consumes affinity (graduate/weight/neg-exclude/loved-seeds)"
git push
```

---

## Task 6: chat path — drop skip demotion, make wrong_vibe negative

**Files:**
- Modify: `server/context-builder.js` (demotion block ~line 320-321, 367; the stale-love flag ~263-264; `{{DEMOTED}}` replacement ~407-409; imports)
- Modify: `server/state-db.js` (remove `staleLoves`, `skipStats`)
- Modify: `prompts/user-turn.md` (`{{DEMOTED}}` section wording)

No new unit test (context-builder is IO-heavy and already covered by retriever/affinity tests); verified by full suite + live check in Task 7.

- [ ] **Step 1: Replace the demotion source**

In `server/context-builder.js`, change the import line `import db, { ..., skipStats, staleLoves } from './state-db.js';` to drop `skipStats, staleLoves` and add `import { wrongVibeSongs, negativeKeys } from './affinity.js';`.

Replace the demoted block (was `skipStats` + `staleLoves`):

```js
  // 负反馈:wrong_vibe = 明确不喜欢(别再推)。skip 不再降权(skip 是正常浏览行为)。
  const demoted = wrongVibeSongs().map(r => ({ song_title: r.song_title, song_artist: r.song_artist, skips: 0 }));
  const negKeys = negativeKeys();
```

- [ ] **Step 2: Apply wrong_vibe to the explore exclude set**

In the explore `excludeKeys` construction, replace the `for (const d of demoted) ...` line with:

```js
      for (const k of negKeys) excludeKeys.add(k);  // wrong_vibe + cooldown 不进 explore
```

- [ ] **Step 3: Remove the 90-day love-decay flag**

Find the love-decay line (`const stale = f.signal === 'love' && days > 90 ? ' ⚠旧爱...' : '';`) and remove the `stale` flag (loves no longer expire). Delete the variable and its use in that formatter.

- [ ] **Step 4: Update the `{{DEMOTED}}` replacement wording**

The `.replace('{{DEMOTED}}', ...)` now lists wrong_vibe:

```js
    .replace('{{DEMOTED}}', demoted.length
      ? demoted.map(d => `- ${d.song_title} / ${d.song_artist} (你标记过 wrong_vibe)`).join('\n')
      : '(无)')
```

In `prompts/user-turn.md` change the section heading/desc:

```markdown
### 不喜欢(wrong_vibe —— 别再推)
{{DEMOTED}}
```

- [ ] **Step 5: Remove dead functions**

In `server/state-db.js`, delete the `skipStats` and `staleLoves` function definitions (no remaining callers).

- [ ] **Step 6: Syntax + full suite + commit**

Run: `node --check server/context-builder.js && node --check server/state-db.js && npm test`
Expected: green.

```bash
git add server/context-builder.js server/state-db.js prompts/user-turn.md
git commit -m "feat(dj): chat path drops skip-demotion, treats wrong_vibe as real negative"
git push
```

---

## Task 7: chat path — prioritize loved songs + inject live taste

**Files:**
- Modify: `server/context-builder.js` (librarySlice prioritization; explore seeds; `{{LIVE_TASTE}}` replace; imports)
- Modify: `prompts/user-turn.md` (add `{{LIVE_TASTE}}` section)

- [ ] **Step 1: Add imports + live-taste section to template**

In `server/context-builder.js` add to the affinity import: `songAffinity, artistAffinity, songWeight, lovedSeeds, liveTasteBlock`.

In `prompts/user-turn.md`, add right after the `## 探索档位` block (before `## RAG 检索结果`):

```markdown
## 你最近确认的口味(运行时 love 积累 —— 优先于下方静态档案)
{{LIVE_TASTE}}
```

- [ ] **Step 2: Prioritize loved songs in the library slice**

After `librarySlice` is finalized, sort it by affinity so loved library songs surface first:

```js
  const _songAff = songAffinity(), _artistAff = artistAffinity();
  librarySlice = [...librarySlice].sort(
    (a, b) => songWeight({ name: b.name, artist: b.artist }, { songAff: _songAff, artistAff: _artistAff })
            - songWeight({ name: a.name, artist: a.artist }, { songAff: _songAff, artistAff: _artistAff })
  );
```

- [ ] **Step 3: Seed exploration from loves (no-direction path)**

In the `if (!seeds.length)` block (no-direction explore seeds), prepend loved seeds before now-playing/RAG:

```js
      seeds.push(...lovedSeeds(4));
      if (now && typeof now.ncm_id === 'number') seeds.push({ ncm_id: now.ncm_id, name: now.title, artist: now.artist });
```

(Keep the existing RAG-song fill loop after, with the `seeds.length >= 5` cap.)

- [ ] **Step 4: Inject the live-taste block**

Add to the `userContent` `.replace(...)` chain:

```js
    .replace('{{LIVE_TASTE}}', liveTasteBlock())
```

- [ ] **Step 5: Syntax + full suite**

Run: `node --check server/context-builder.js && npm test`
Expected: green.

- [ ] **Step 6: Live check (isolated instance)**

Boot the :8099 snapshot instance (as in Task 5). Love a couple songs by a new artist, then send a chat recommend — confirm the live-taste block reaches the prompt (check `data/llm-calls.jsonl` on the test DB) and recs lean toward loved artists.

- [ ] **Step 7: Doc + commit**

Update `nightliner-design-v0.5.md` §3.2 / LLM-contract: chat path injects `{{LIVE_TASTE}}`, prioritizes loved songs, seeds explore from loves; love no longer decays.

```bash
git add server/context-builder.js prompts/user-turn.md nightliner-design-v0.5.md
git commit -m "feat(dj): chat path prioritizes loves + injects live-taste block"
git push
```

---

## Task 8: backfill ncm_id for existing loves

**Files:**
- Create: `scripts/backfill-feedback-ncmid.js`

- [ ] **Step 1: Write the script**

```js
// scripts/backfill-feedback-ncmid.js
// One-shot: resolve ncm_id for pre-existing love feedback that predates the ncm_id column.
// Best-effort — unresolved rows stay null (still count for artist affinity).
import db from '../server/state-db.js';
import { cloudsearch } from '../server/ncm-client.js';

const rows = db.prepare("SELECT id, song_title, song_artist FROM feedback WHERE signal='love' AND ncm_id IS NULL").all();
console.log(`backfilling ${rows.length} loves...`);
let ok = 0;
for (const r of rows) {
  try {
    const res = await cloudsearch(`${r.song_title} ${(r.song_artist || '').split('/')[0]}`);
    const hit = res?.result?.songs?.[0];
    if (hit?.id) { db.prepare("UPDATE feedback SET ncm_id=? WHERE id=?").run(hit.id, r.id); ok++; }
  } catch (e) { console.warn('skip', r.song_title, e.message); }
}
console.log(`resolved ${ok}/${rows.length}`);
process.exit(0);
```

(Verify `cloudsearch` is exported from `server/ncm-client.js`; if the export name differs, use the actual search function there and the matching result shape.)

- [ ] **Step 2: Run it against production (NCM must be up on :3000)**

Run: `node --env-file=.env scripts/backfill-feedback-ncmid.js`
Expected: prints `resolved N/41`.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-feedback-ncmid.js
git commit -m "chore(dj): one-shot backfill of ncm_id for legacy love feedback"
git push
```

---

## Self-review notes

- **Spec coverage:** affinity store (T2), love cumulative/durable + no decay (T2/T6), graduation (T2/T5), simi seeded from loves (T5/T7), wrong_vibe negative (T5/T6), too_familiar cooldown unchanged (existing) + artist untouched (no artist penalty applied from cooldown — only wrong_vibe×2 would, deferred), skip = rotation-only via removing staleLoves/skipStats (T6), liveTasteBlock view (T3/T7), both paths read store (T5 listen / T7 chat), backfill (T8). All covered.
- **Type consistency:** `songWeight(song, {songAff, artistAff})`, `lovedSeeds(limit)`, `graduatedLibrary(libKeySet)`, `negativeSongs()`/`negativeKeys()`, `weightedOrder(items, weightOf, rng)`, `buildPlaylist({...weightOf})` — names consistent across tasks.
- **Deferred (YAGNI, in spec non-goals):** completion-weighted skip; artist down-weight from cooldown; LLM consolidation. The `wrongVibeArtists` artist-penalty from the spec table is left as a follow-up (wrong_vibe currently penalizes the song hard; artist penalty needs care to avoid over-pruning) — note for review.
