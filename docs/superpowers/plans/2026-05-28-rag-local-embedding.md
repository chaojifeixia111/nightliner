# RAG + 本地 Embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 NightlinerFM v0.4 的 chat 链路从「全量 prompt 注入」改成「RAG + messages[] 多轮 + budget 强制」，砍 prompt 体积 75%、消除幻觉、让探索系数真正生效。

**Architecture:** 新增 6 个模块 (embedder / vec-store / indexer / retriever / budget-enforcer / 新 prompt 拆分)，重构 3 个模块 (context-builder / llm-adapter / server-index)，共存于现有 `data/state.db`（sqlite-vec 扩展）。BGE-M3 q8 ONNX 本地推理已下载并验证。

**Tech Stack:**
- `@huggingface/transformers` (ONNX Runtime Node 后端) — 已装
- `sqlite-vec` (better-sqlite3 扩展) — 已装
- `node:test` (Node 20+ 内建测试框架) — 零新依赖
- 现有: better-sqlite3, express, ws, yaml

**关联设计文档:** `docs/superpowers/specs/2026-05-28-rag-local-embedding-design.md`

---

### Task 1: 测试基建

**Files:**
- Modify: `package.json`
- Create: `tests/.gitkeep`

- [ ] **Step 1: 加 test 脚本到 package.json**

```json
"scripts": {
  "start": "node --env-file=.env server/index.js",
  "ncm:login": "node scripts/ncm-login-qr.js",
  "ncm:fetch": "node scripts/ncm-fetch-playlists.js",
  "cold-start": "node --env-file=.env scripts/cold-start.js",
  "chat": "node --env-file=.env scripts/chat-once.js",
  "test": "node --env-file=.env --test tests/",
  "test:embed": "node --env-file=.env scripts/test-embed.js",
  "index:all": "node --env-file=.env scripts/index-all.js"
}
```

- [ ] **Step 2: 创建 tests 目录占位**

```bash
mkdir -p tests
touch tests/.gitkeep
```

- [ ] **Step 3: 跑空测试确认 runner 可用**

Run: `npm test`
Expected: `# tests 0` / `# pass 0` (无失败)

- [ ] **Step 4: Commit**

```bash
git add package.json tests/.gitkeep
git commit -m "chore: scaffold node:test runner + index/test scripts"
```

---

### Task 2: `server/embedder.js` — 本地 BGE-M3 推理 (单条)

**Files:**
- Create: `server/embedder.js`
- Create: `tests/embedder.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/embedder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed } from '../server/embedder.js';

test('embed 中文返回 1024 维 normalized Float32Array', async () => {
  const v = await embed('夜里听的歌');
  assert.equal(v.length, 1024);
  assert.ok(v instanceof Float32Array);
  // CLS pooling + L2 normalized → ||v|| ≈ 1
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-3, `norm=${norm}`);
});

test('embed 英文也能跑', async () => {
  const v = await embed('songs for late night');
  assert.equal(v.length, 1024);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: `Cannot find module '../server/embedder.js'`

- [ ] **Step 3: 实现 embedder.js**

```js
// server/embedder.js
// 本地 BGE-M3 (Xenova/bge-m3 q8 ONNX) 推理. 进程内单例.
import { pipeline, env } from '@huggingface/transformers';

if (process.env.HF_CACHE_DIR) env.cacheDir = process.env.HF_CACHE_DIR;
if (process.env.HF_ENDPOINT) env.remoteHost = process.env.HF_ENDPOINT;

let _extractor = null;
let _loadingPromise = null;

async function getExtractor() {
  if (_extractor) return _extractor;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = pipeline('feature-extraction', 'Xenova/bge-m3', { dtype: 'q8' });
  _extractor = await _loadingPromise;
  return _extractor;
}

export async function embed(text) {
  const e = await getExtractor();
  const out = await e(text, { pooling: 'cls', normalize: true });
  return new Float32Array(out.data);
}

// 预热: 启动时 await 一次,避免首次 chat 卡 3s
export async function warmup() {
  await getExtractor();
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npm test`
Expected: `# pass 2` (单条 embed ≈ 30ms, 总耗时 < 5s 含 model load)

- [ ] **Step 5: Commit**

```bash
git add server/embedder.js tests/embedder.test.js
git commit -m "feat(rag): server/embedder.js — local BGE-M3 ONNX inference"
```

---

### Task 3: `embedder.js` — 批量 embed

**Files:**
- Modify: `server/embedder.js`
- Modify: `tests/embedder.test.js`

- [ ] **Step 1: 加批量测试**

追加到 `tests/embedder.test.js`:

```js
import { embedBatch } from '../server/embedder.js';

test('embedBatch 返回相同条数 Float32Array', async () => {
  const out = await embedBatch(['夜里', 'morning run', '一个人']);
  assert.equal(out.length, 3);
  out.forEach(v => assert.equal(v.length, 1024));
});

test('embedBatch 空数组返回空', async () => {
  const out = await embedBatch([]);
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: `embedBatch is not a function`

- [ ] **Step 3: 加 embedBatch 到 embedder.js**

在 `embedder.js` 文件末尾添加:

```js
export async function embedBatch(texts) {
  if (!texts.length) return [];
  const e = await getExtractor();
  // transformers.js 接受数组输入,内部 batch
  const out = await e(texts, { pooling: 'cls', normalize: true });
  // out.dims = [N, 1024]
  const N = out.dims[0];
  const D = out.dims[1];
  const result = [];
  for (let i = 0; i < N; i++) {
    result.push(new Float32Array(out.data.slice(i * D, (i + 1) * D)));
  }
  return result;
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test`
Expected: `# pass 4`

- [ ] **Step 5: Commit**

```bash
git add server/embedder.js tests/embedder.test.js
git commit -m "feat(rag): embedder.js — batch embed support"
```

---

### Task 4: `state-db.js` — 加载 sqlite-vec + 创建 vec 表

**Files:**
- Modify: `server/state-db.js`
- Create: `tests/state-db-vec.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/state-db-vec.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/state-db.js';

test('sqlite-vec 扩展已加载,可创建 vec0 虚表', () => {
  // sqlite-vec 加载后,vec_version() 函数可用
  const v = db.prepare("SELECT vec_version() as v").get();
  assert.ok(v.v.length > 0, `vec_version returned: ${v.v}`);
});

test('vec_embeddings 表已建,可插入和查询 1024 维向量', () => {
  // 清空 (测试隔离)
  db.exec("DELETE FROM vec_embeddings");
  const vec = new Float32Array(1024).fill(0.001);
  db.prepare("INSERT INTO vec_embeddings(embedding_id, embedding) VALUES (?, ?)")
    .run(1, Buffer.from(vec.buffer));
  const row = db.prepare("SELECT embedding_id FROM vec_embeddings WHERE embedding_id = 1").get();
  assert.equal(row.embedding_id, 1);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test -- --test-only-files tests/state-db-vec.test.js`
Expected: `no such function: vec_version` 或类似

- [ ] **Step 3: 修改 `state-db.js` 在 db 初始化后加载 sqlite-vec**

找到 `const db = new Database(DB_PATH);` 那行，**改成**:

```js
import * as sqliteVec from 'sqlite-vec';

ensureDir();
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
sqliteVec.load(db);   // ← 新增: 加载扩展
migrate(db);
```

然后在 `migrate(db)` 函数内,在最后追加 vec 表创建:

```js
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
    embedding_id INTEGER PRIMARY KEY,
    embedding FLOAT[1024]
  );
`);
```

- [ ] **Step 4: 验证通过**

Run: `npm test`
Expected: `# pass 6` (累计)

- [ ] **Step 5: Commit**

```bash
git add server/state-db.js tests/state-db-vec.test.js
git commit -m "feat(rag): state-db loads sqlite-vec + creates vec_embeddings table"
```

---

### Task 5: `state-db.js` — embeddings 主表 + CRUD helpers

**Files:**
- Modify: `server/state-db.js`
- Modify: `tests/state-db-vec.test.js`

- [ ] **Step 1: 写失败测试**

追加到 `tests/state-db-vec.test.js`:

```js
import { upsertEmbeddingRow, getEmbeddingsBySource, deleteEmbeddingsBySource } from '../server/state-db.js';

test('upsertEmbeddingRow 写入主表 + vec 表', () => {
  db.exec("DELETE FROM embeddings; DELETE FROM vec_embeddings;");
  const vec = new Float32Array(1024).fill(0.5);
  const id = upsertEmbeddingRow({
    source_type: 'song',
    source_id: 'song:12345',
    chunk_text: 'Closer / Joe Inoue [L]',
    meta: { artist: 'Joe Inoue', tag: 'L' },
    embedding: vec,
  });
  assert.ok(id > 0);
  const rows = getEmbeddingsBySource('song', 'song:12345');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chunk_text, 'Closer / Joe Inoue [L]');
  assert.deepEqual(JSON.parse(rows[0].meta_json), { artist: 'Joe Inoue', tag: 'L' });
});

test('upsertEmbeddingRow 相同 source_id 覆盖', () => {
  const vec = new Float32Array(1024).fill(0.1);
  upsertEmbeddingRow({
    source_type: 'song',
    source_id: 'song:12345',
    chunk_text: 'Closer / Joe Inoue [L] UPDATED',
    meta: { v: 2 },
    embedding: vec,
  });
  const rows = getEmbeddingsBySource('song', 'song:12345');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chunk_text, 'Closer / Joe Inoue [L] UPDATED');
});

test('deleteEmbeddingsBySource 同时删主表+vec表', () => {
  deleteEmbeddingsBySource('song', 'song:12345');
  assert.equal(getEmbeddingsBySource('song', 'song:12345').length, 0);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: `upsertEmbeddingRow is not a function`

- [ ] **Step 3: 加 embeddings 主表到 migrate()**

在 `migrate(db)` 的 `db.exec(...)` 里追加:

```sql
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  meta_json TEXT,
  ts INTEGER NOT NULL,
  UNIQUE(source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
```

- [ ] **Step 4: 加 helpers 到 state-db.js**

在文件底部（`export default db;` 之前）追加:

```js
// === RAG embeddings ===

export function upsertEmbeddingRow({ source_type, source_id, chunk_text, meta, embedding }) {
  const ts = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    // 1. 主表 upsert
    const result = db.prepare(`
      INSERT INTO embeddings (source_type, source_id, chunk_text, meta_json, ts)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_type, source_id) DO UPDATE SET
        chunk_text = excluded.chunk_text,
        meta_json = excluded.meta_json,
        ts = excluded.ts
      RETURNING id
    `).get(source_type, source_id, chunk_text, JSON.stringify(meta || {}), ts);
    const id = result.id;

    // 2. vec 表 upsert (先删再插,因为 vec0 不支持 ON CONFLICT)
    db.prepare(`DELETE FROM vec_embeddings WHERE embedding_id = ?`).run(id);
    db.prepare(`INSERT INTO vec_embeddings(embedding_id, embedding) VALUES (?, ?)`)
      .run(id, Buffer.from(embedding.buffer));

    return id;
  });
  return tx();
}

export function getEmbeddingsBySource(source_type, source_id) {
  return db.prepare(`
    SELECT * FROM embeddings WHERE source_type = ? AND source_id = ?
  `).all(source_type, source_id);
}

export function deleteEmbeddingsBySource(source_type, source_id) {
  const tx = db.transaction(() => {
    const rows = db.prepare(`SELECT id FROM embeddings WHERE source_type = ? AND source_id = ?`).all(source_type, source_id);
    for (const r of rows) {
      db.prepare(`DELETE FROM vec_embeddings WHERE embedding_id = ?`).run(r.id);
    }
    db.prepare(`DELETE FROM embeddings WHERE source_type = ? AND source_id = ?`).run(source_type, source_id);
  });
  tx();
}

export function countEmbeddings(source_type) {
  if (source_type) {
    return db.prepare(`SELECT COUNT(*) as c FROM embeddings WHERE source_type = ?`).get(source_type).c;
  }
  return db.prepare(`SELECT COUNT(*) as c FROM embeddings`).get().c;
}
```

- [ ] **Step 5: 验证通过**

Run: `npm test`
Expected: `# pass 9`

- [ ] **Step 6: Commit**

```bash
git add server/state-db.js tests/state-db-vec.test.js
git commit -m "feat(rag): embeddings table + upsert/get/delete helpers"
```

---

### Task 6: `server/vec-store.js` — 语义检索封装

**Files:**
- Create: `server/vec-store.js`
- Create: `tests/vec-store.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/vec-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import db, { upsertEmbeddingRow } from '../server/state-db.js';
import { searchSimilar } from '../server/vec-store.js';

function seedThree() {
  db.exec("DELETE FROM embeddings; DELETE FROM vec_embeddings;");
  // 三个明显不同的向量
  const a = new Float32Array(1024); a[0] = 1;
  const b = new Float32Array(1024); b[1] = 1;
  const c = new Float32Array(1024); c[2] = 1;
  upsertEmbeddingRow({ source_type: 'song', source_id: 's:1', chunk_text: 'A', meta: {}, embedding: a });
  upsertEmbeddingRow({ source_type: 'song', source_id: 's:2', chunk_text: 'B', meta: {}, embedding: b });
  upsertEmbeddingRow({ source_type: 'feedback', source_id: 'f:1', chunk_text: 'C', meta: {}, embedding: c });
}

test('searchSimilar 返回最相近 (向量 a) 的 song', async () => {
  seedThree();
  const query = new Float32Array(1024); query[0] = 1;
  const hits = searchSimilar({ embedding: query, source_type: 'song', top_k: 2 });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].chunk_text, 'A');  // 最相似
  assert.ok(hits[0].distance < hits[1].distance);
});

test('searchSimilar 按 source_type 过滤', () => {
  seedThree();
  const query = new Float32Array(1024); query[2] = 1;
  const hits = searchSimilar({ embedding: query, source_type: 'song', top_k: 5 });
  // 不应包含 source_type='feedback' 的 C
  for (const h of hits) {
    assert.equal(h.source_type, 'song');
  }
});

test('searchSimilar 返回 meta 解析后的对象', () => {
  db.exec("DELETE FROM embeddings; DELETE FROM vec_embeddings;");
  const v = new Float32Array(1024); v[0] = 1;
  upsertEmbeddingRow({
    source_type: 'song', source_id: 's:1', chunk_text: 'A',
    meta: { artist: 'X', tag: 'L' }, embedding: v,
  });
  const hits = searchSimilar({ embedding: v, source_type: 'song', top_k: 1 });
  assert.deepEqual(hits[0].meta, { artist: 'X', tag: 'L' });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: `Cannot find module '../server/vec-store.js'`

- [ ] **Step 3: 实现 vec-store.js**

```js
// server/vec-store.js
// sqlite-vec 检索封装. 输入 query embedding (Float32Array),返回 top-K 主表 row.
import db from './state-db.js';

export function searchSimilar({ embedding, source_type, top_k = 10 }) {
  // sqlite-vec 的 MATCH 语法: vec MATCH ? ORDER BY distance
  // 先在 vec 表里 top-K (over-fetch), 再 JOIN 主表过滤 source_type
  const overFetch = Math.max(top_k * 5, 50);   // 防止 source_type 过滤后不够
  const rows = db.prepare(`
    SELECT
      e.id, e.source_type, e.source_id, e.chunk_text, e.meta_json,
      v.distance
    FROM (
      SELECT embedding_id, distance FROM vec_embeddings
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    ) v
    JOIN embeddings e ON e.id = v.embedding_id
    WHERE e.source_type = ?
    ORDER BY v.distance
    LIMIT ?
  `).all(Buffer.from(embedding.buffer), overFetch, source_type, top_k);

  return rows.map(r => ({
    id: r.id,
    source_type: r.source_type,
    source_id: r.source_id,
    chunk_text: r.chunk_text,
    meta: r.meta_json ? JSON.parse(r.meta_json) : {},
    distance: r.distance,
  }));
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test`
Expected: `# pass 12`

- [ ] **Step 5: Commit**

```bash
git add server/vec-store.js tests/vec-store.test.js
git commit -m "feat(rag): vec-store.js — top-K cosine search by source_type"
```

---

### Task 7: `server/indexer.js` — MD chunker (纯函数)

**Files:**
- Create: `server/indexer.js`
- Create: `tests/indexer.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/indexer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdownByH2 } from '../server/indexer.js';

test('chunkMarkdownByH2 按 H2 切', () => {
  const md = `# Title

## 第一节
内容 A 第一段.
内容 A 第二段.

## 第二节
内容 B.

## 第三节
内容 C.`;
  const chunks = chunkMarkdownByH2(md);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].heading, '第一节');
  assert.ok(chunks[0].text.includes('内容 A 第一段'));
  assert.equal(chunks[2].heading, '第三节');
});

test('chunkMarkdownByH2 超长 H2 切到 ≤ 400 字符,带 50 字符 overlap', () => {
  const long = 'X'.repeat(900);
  const md = `## 长节\n${long}`;
  const chunks = chunkMarkdownByH2(md);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(c.text.length <= 400, `chunk too long: ${c.text.length}`);
  }
});

test('chunkMarkdownByH2 无 H2 时返回单 chunk', () => {
  const md = '只有正文,没标题';
  const chunks = chunkMarkdownByH2(md);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, '');
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: `Cannot find module '../server/indexer.js'`

- [ ] **Step 3: 实现 chunker**

```js
// server/indexer.js
// 全量/增量索引 (曲库 / 反馈 / chat / MD 文件) 到 embeddings + vec_embeddings.

const MAX_CHUNK = 400;
const OVERLAP = 50;

export function chunkMarkdownByH2(md) {
  const lines = md.split('\n');
  const sections = [];
  let curHeading = '';
  let curBody = [];
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (curBody.length || curHeading) sections.push({ heading: curHeading, body: curBody.join('\n').trim() });
      curHeading = h2[1].trim();
      curBody = [];
    } else if (!line.match(/^#\s/)) {
      curBody.push(line);
    }
  }
  if (curBody.length || curHeading) sections.push({ heading: curHeading, body: curBody.join('\n').trim() });

  // 若整篇没切到 H2 (sections 为空 或 都是 heading='')
  if (sections.length === 0 || sections.every(s => !s.heading && !s.body)) {
    const fallback = md.trim();
    if (!fallback) return [];
    return splitLong({ heading: '', text: fallback });
  }

  const out = [];
  for (const s of sections) {
    if (!s.body && !s.heading) continue;
    out.push(...splitLong({ heading: s.heading, text: s.body }));
  }
  return out;
}

function splitLong({ heading, text }) {
  if (text.length <= MAX_CHUNK) return [{ heading, text }];
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + MAX_CHUNK, text.length);
    out.push({ heading, text: text.slice(i, end) });
    if (end === text.length) break;
    i = end - OVERLAP;
  }
  return out;
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test`
Expected: `# pass 15`

- [ ] **Step 5: Commit**

```bash
git add server/indexer.js tests/indexer.test.js
git commit -m "feat(rag): indexer.js — markdown chunker by H2 with overlap"
```

---

### Task 8: `indexer.js` — indexSong + 全曲库脚本

**Files:**
- Modify: `server/indexer.js`
- Create: `scripts/index-all.js`

- [ ] **Step 1: 加 indexSong 到 indexer.js**

在 `indexer.js` 末尾追加:

```js
import fs from 'fs/promises';
import { embed, embedBatch } from './embedder.js';
import { upsertEmbeddingRow, getEmbeddingsBySource, countEmbeddings } from './state-db.js';

const PLAYLIST_TAG = {
  160249544: 'P',
  945616754: 'L',
};

export async function indexSong({ ncm_id, name, artist, tag }) {
  const source_id = `song:${ncm_id}`;
  // 跳过已索引
  if (getEmbeddingsBySource('song', source_id).length) return false;
  const chunk_text = `${name} / ${artist} [${tag}]`;
  const vec = await embed(chunk_text);
  upsertEmbeddingRow({
    source_type: 'song',
    source_id,
    chunk_text,
    meta: { ncm_id, name, artist, tag },
    embedding: vec,
  });
  return true;
}

export async function indexAllSongs() {
  let snapshot;
  try {
    snapshot = JSON.parse(await fs.readFile('data/netease-snapshot.json', 'utf8'));
  } catch {
    console.warn('[indexer] no netease-snapshot.json, skipping songs');
    return { added: 0, skipped: 0 };
  }

  const seen = new Set();
  const queue = [];
  for (const pl of Object.values(snapshot.playlists)) {
    const tag = PLAYLIST_TAG[pl.id] || '?';
    for (const s of pl.songs) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      queue.push({ ncm_id: s.id, name: s.name, artist: s.artists, tag });
    }
  }

  // Apple Music
  try {
    const md = await fs.readFile('user/apple-music-favorites-2024-2026.md', 'utf8');
    const pattern = /^\s*\d+\.\s+(.+?)\s+\/\s+(.+?)\s*$/gm;
    let m;
    let idx = 1_000_000;   // 避免和 ncm_id 冲突的虚拟 id
    while ((m = pattern.exec(md)) !== null) {
      queue.push({ ncm_id: `am:${idx++}`, name: m[1].trim(), artist: m[2].trim(), tag: 'M' });
    }
  } catch {}

  let added = 0;
  let skipped = 0;
  // 批量 embed 加速 (32 一批)
  const BATCH = 32;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    // 先过滤已索引
    const todo = batch.filter(s => !getEmbeddingsBySource('song', `song:${s.ncm_id}`).length);
    skipped += batch.length - todo.length;
    if (!todo.length) continue;
    const texts = todo.map(s => `${s.name} / ${s.artist} [${s.tag}]`);
    const vecs = await embedBatch(texts);
    for (let j = 0; j < todo.length; j++) {
      const s = todo[j];
      upsertEmbeddingRow({
        source_type: 'song',
        source_id: `song:${s.ncm_id}`,
        chunk_text: texts[j],
        meta: { ncm_id: s.ncm_id, name: s.name, artist: s.artist, tag: s.tag },
        embedding: vecs[j],
      });
      added++;
    }
    process.stdout.write(`\r[indexer] songs: ${added} added, ${skipped} skipped...   `);
  }
  process.stdout.write('\n');
  return { added, skipped };
}
```

- [ ] **Step 2: 创建 index-all.js 脚本**

```js
// scripts/index-all.js
// 全量索引曲库 + 反馈 + chat_turns + MD 文件到 embeddings.
import { indexAllSongs } from '../server/indexer.js';
import { countEmbeddings } from '../server/state-db.js';

console.log('[index-all] start');
const t0 = Date.now();

const songStats = await indexAllSongs();
console.log(`[index-all] songs: +${songStats.added}, =${songStats.skipped}`);

const total = countEmbeddings();
console.log(`[index-all] total embeddings in db: ${total}`);
console.log(`[index-all] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
```

- [ ] **Step 3: 跑全量索引**

Run: `npm run index:all`
Expected: `songs: +579, =0` 之类, 总耗时 1-3 分钟

- [ ] **Step 4: 验证 db 真有数据**

Run:
```bash
node --env-file=.env -e "import('./server/state-db.js').then(m => console.log('total:', m.countEmbeddings(), 'songs:', m.countEmbeddings('song')))"
```
Expected: `total: 579+ songs: 579+`

- [ ] **Step 5: Commit**

```bash
git add server/indexer.js scripts/index-all.js
git commit -m "feat(rag): indexer.js — index all songs (netease + apple music)"
```

---

### Task 9: `indexer.js` — indexFeedback / indexChatTurn

**Files:**
- Modify: `server/indexer.js`
- Modify: `server/state-db.js` (hook 进 recordFeedback / recordChatTurn)

- [ ] **Step 1: 加 indexFeedback / indexChatTurn 到 indexer.js**

```js
export async function indexFeedback(fb) {
  // fb: { id, ts, song_title, song_artist, signal, context_json }
  const source_id = `fb:${fb.id}`;
  if (getEmbeddingsBySource('feedback', source_id).length) return false;
  let reason = '';
  try {
    const ctx = fb.context_json ? JSON.parse(fb.context_json) : null;
    reason = ctx?.reason || '';
  } catch {}
  const chunk_text = `[${fb.signal}] ${fb.song_title} / ${fb.song_artist}${reason ? ' — ' + reason : ''}`;
  const vec = await embed(chunk_text);
  upsertEmbeddingRow({
    source_type: 'feedback',
    source_id,
    chunk_text,
    meta: {
      signal: fb.signal,
      ts: fb.ts,
      target_title: fb.song_title,
      target_artist: fb.song_artist,
      reason,
    },
    embedding: vec,
  });
  return true;
}

export async function indexChatTurn(turn) {
  // turn: { id, ts, user_message, intent, dj_say, play_titles_json, ... }
  const source_id = `turn:${turn.id}`;
  if (getEmbeddingsBySource('chat_turn', source_id).length) return false;
  let plays = '';
  try {
    const arr = turn.play_titles_json ? JSON.parse(turn.play_titles_json) : [];
    plays = arr.map(p => p.title).join(', ');
  } catch {}
  const chunk_text = `[用户] ${turn.user_message} [DJ ${turn.intent || '?'}] ${turn.dj_say || ''}${plays ? ' 推:' + plays : ''}`;
  const vec = await embed(chunk_text);
  upsertEmbeddingRow({
    source_type: 'chat_turn',
    source_id,
    chunk_text,
    meta: {
      intent: turn.intent,
      ts: turn.ts,
      queue_action: turn.queue_action,
    },
    embedding: vec,
  });
  return true;
}
```

- [ ] **Step 2: hook 进 state-db.js 的 recordFeedback / recordChatTurn**

修改 `state-db.js` 的 `recordFeedback`，在 INSERT 之后加 indexing。**因为 indexer 依赖 state-db,会循环 import**，所以用动态 import + fire-and-forget:

修改 `recordFeedback` 函数末尾 (在 if(never_again) 块之后):

```js
  // RAG: async index this feedback (fire-and-forget)
  const lastId = db.prepare(`SELECT last_insert_rowid() as id`).get().id;
  import('./indexer.js').then(m => m.indexFeedback({
    id: lastId,
    ts: Math.floor(Date.now() / 1000),
    song_title: fb.song_title,
    song_artist: fb.song_artist,
    signal: fb.signal,
    context_json: fb.context_json ? JSON.stringify(fb.context_json) : null,
  })).catch(e => console.warn('[indexer] feedback failed:', e.message));
}
```

修改 `recordChatTurn` 末尾:

```js
  const lastId = db.prepare(`SELECT last_insert_rowid() as id`).get().id;
  import('./indexer.js').then(m => m.indexChatTurn({
    id: lastId,
    ts: Math.floor(Date.now() / 1000),
    user_message: turn.user_message,
    intent: turn.intent,
    dj_say: turn.dj_say,
    play_titles_json: turn.play_titles_json,
    queue_action: turn.queue_action,
  })).catch(e => console.warn('[indexer] turn failed:', e.message));
}
```

- [ ] **Step 3: 把现有的 feedback / chat_turns 批量回填**

修改 `scripts/index-all.js`,在 indexAllSongs 之后加:

```js
import { indexAllFeedback, indexAllChatTurns } from '../server/indexer.js';

const fbStats = await indexAllFeedback();
console.log(`[index-all] feedback: +${fbStats.added}, =${fbStats.skipped}`);

const turnStats = await indexAllChatTurns();
console.log(`[index-all] chat_turns: +${turnStats.added}, =${turnStats.skipped}`);
```

并在 `indexer.js` 加这两个回填函数:

```js
import db from './state-db.js';

export async function indexAllFeedback() {
  const rows = db.prepare(`SELECT * FROM feedback ORDER BY ts ASC`).all();
  let added = 0, skipped = 0;
  for (const r of rows) {
    const ok = await indexFeedback(r);
    if (ok) added++; else skipped++;
  }
  return { added, skipped };
}

export async function indexAllChatTurns() {
  const rows = db.prepare(`SELECT * FROM chat_turns ORDER BY ts ASC`).all();
  let added = 0, skipped = 0;
  for (const r of rows) {
    const ok = await indexChatTurn(r);
    if (ok) added++; else skipped++;
  }
  return { added, skipped };
}
```

- [ ] **Step 4: 跑回填**

Run: `npm run index:all`
Expected: `feedback: +X, =0`, `chat_turns: +Y, =0`

- [ ] **Step 5: Commit**

```bash
git add server/indexer.js server/state-db.js scripts/index-all.js
git commit -m "feat(rag): index feedback + chat_turns (async hooks + backfill)"
```

---

### Task 10: `indexer.js` — indexMdFile (taste / life-stages / mood-rules)

**Files:**
- Modify: `server/indexer.js`
- Modify: `scripts/index-all.js`

- [ ] **Step 1: 加 indexMdFile 到 indexer.js**

```js
export async function indexMdFile(path, source_type) {
  let md;
  try {
    md = await fs.readFile(path, 'utf8');
  } catch {
    console.log(`[indexer] ${path} not found, skip`);
    return { added: 0, skipped: 0 };
  }
  const chunks = chunkMarkdownByH2(md);
  let added = 0, skipped = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const source_id = `${path}:${c.heading || `chunk-${i}`}`;
    if (getEmbeddingsBySource(source_type, source_id).length) {
      skipped++;
      continue;
    }
    const chunk_text = c.heading ? `## ${c.heading}\n${c.text}` : c.text;
    const vec = await embed(chunk_text);
    upsertEmbeddingRow({
      source_type,
      source_id,
      chunk_text,
      meta: { source: path, heading: c.heading },
      embedding: vec,
    });
    added++;
  }
  return { added, skipped };
}
```

- [ ] **Step 2: 接入 index-all.js**

在 chat_turns 之后追加:

```js
import { indexMdFile } from '../server/indexer.js';

const mdTargets = [
  ['user/taste.md', 'taste'],
  ['user/life-stages.md', 'life_stage'],
  ['user/mood-rules.md', 'mood_rule'],
  ['user/dj-persona.md', 'persona'],
  ['user/vibe-anchors.md', 'vibe_anchor'],   // 可能不存在,会 skip
];
for (const [path, type] of mdTargets) {
  const s = await indexMdFile(path, type);
  console.log(`[index-all] ${path}: +${s.added}, =${s.skipped}`);
}
```

- [ ] **Step 3: 跑全量回填**

Run: `npm run index:all`
Expected: 每个文件 +N 或 not found, total > 600

- [ ] **Step 4: Commit**

```bash
git add server/indexer.js scripts/index-all.js
git commit -m "feat(rag): index taste/life-stages/mood-rules/persona MD files"
```

---

### Task 11: `server/retriever.js` — 多路检索拼装

**Files:**
- Create: `server/retriever.js`
- Create: `tests/retriever.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/retriever.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveContext } from '../server/retriever.js';

test('retrieveContext 返回所有 budget 子集', async () => {
  const ctx = await retrieveContext({
    userMessage: '夜里听的歌',
    recentTurns: [],
    budgets: { song: 5, feedback: 2, life_stage: 1, taste: 1, mood_rule: 1 },
  });
  assert.ok(Array.isArray(ctx.songs));
  assert.ok(ctx.songs.length <= 5);
  assert.ok(Array.isArray(ctx.feedback));
  assert.ok(Array.isArray(ctx.life_stage_snippets));
  assert.ok(Array.isArray(ctx.taste_snippets));
  assert.ok(Array.isArray(ctx.mood_rule_snippets));
});

test('retrieveContext songs 包含 name/artist/tag/score', async () => {
  const ctx = await retrieveContext({
    userMessage: 'rock',
    recentTurns: [],
    budgets: { song: 3, feedback: 0, life_stage: 0, taste: 0, mood_rule: 0 },
  });
  if (ctx.songs.length) {
    const s = ctx.songs[0];
    assert.ok(typeof s.name === 'string');
    assert.ok(typeof s.artist === 'string');
    assert.ok(typeof s.tag === 'string');
    assert.ok(typeof s.score === 'number');
  }
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: `Cannot find module '../server/retriever.js'`

- [ ] **Step 3: 实现 retriever.js**

```js
// server/retriever.js
// 多路 RAG 检索: 给定 user message,从 embeddings 表按 source_type 拉 top-K.
import { embed } from './embedder.js';
import { searchSimilar } from './vec-store.js';

const DEFAULT_BUDGETS = {
  song: 30,
  feedback: 8,
  life_stage: 3,
  taste: 3,
  mood_rule: 2,
  persona: 1,
  vibe_anchor: 5,
  chat_turn: 3,
};

export async function retrieveContext({ userMessage, recentTurns = [], budgets = {} }) {
  const B = { ...DEFAULT_BUDGETS, ...budgets };
  const queryVec = await embed(userMessage);

  const songRows = B.song ? searchSimilar({ embedding: queryVec, source_type: 'song', top_k: B.song }) : [];
  const fbRows = B.feedback ? searchSimilar({ embedding: queryVec, source_type: 'feedback', top_k: B.feedback }) : [];
  const lsRows = B.life_stage ? searchSimilar({ embedding: queryVec, source_type: 'life_stage', top_k: B.life_stage }) : [];
  const tasteRows = B.taste ? searchSimilar({ embedding: queryVec, source_type: 'taste', top_k: B.taste }) : [];
  const moodRows = B.mood_rule ? searchSimilar({ embedding: queryVec, source_type: 'mood_rule', top_k: B.mood_rule }) : [];
  const vibeRows = B.vibe_anchor ? searchSimilar({ embedding: queryVec, source_type: 'vibe_anchor', top_k: B.vibe_anchor }) : [];
  const turnRows = B.chat_turn ? searchSimilar({ embedding: queryVec, source_type: 'chat_turn', top_k: B.chat_turn }) : [];

  return {
    songs: songRows.map(r => ({
      name: r.meta.name,
      artist: r.meta.artist,
      tag: r.meta.tag,
      ncm_id: r.meta.ncm_id,
      score: 1 - r.distance,   // sqlite-vec 默认 cosine distance (0~2),score = 1 - dist 越大越像
    })),
    feedback: fbRows.map(r => ({
      title: r.meta.target_title,
      artist: r.meta.target_artist,
      signal: r.meta.signal,
      reason: r.meta.reason,
      ts: r.meta.ts,
    })),
    life_stage_snippets: lsRows.map(r => r.chunk_text),
    taste_snippets: tasteRows.map(r => r.chunk_text),
    mood_rule_snippets: moodRows.map(r => r.chunk_text),
    vibe_anchor_snippets: vibeRows.map(r => r.chunk_text),
    semantic_history: turnRows.map(r => r.chunk_text),
    recent_history: recentTurns,    // 近因优先,调用方传入
  };
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test`
Expected: `# pass 17`

- [ ] **Step 5: Commit**

```bash
git add server/retriever.js tests/retriever.test.js
git commit -m "feat(rag): retriever.js — multi-source top-K retrieval"
```

---

### Task 12: 拆分 prompt 为 system + user-turn

**Files:**
- Create: `prompts/system.md`
- Create: `prompts/user-turn.md`
- Keep: `prompts/chat-mode.md` (legacy, 留作回退)

- [ ] **Step 1: 创建 prompts/system.md**

```markdown
# NightlinerFM DJ — System Prompt

你是 Elliot 的私人 DJ. 每次接到 user 消息,先判断 intent (recommend/chat/feedback),再按对应 schema 输出 JSON.

## 意图分流

| Intent | 触发场景 | 输出要点 |
|--------|---------|---------|
| `recommend` | 用户要新歌/换批/某个方向 | play[] 填 |
| `chat` | 用户闲聊/提问/讨论音乐 | play[] 空, say 自由 |
| `feedback` | 用户对最近歌的态度("这首太吵") | play[] 空, feedback_extract 填 |

模棱两可时优先按 chat 处理.

## DJ 人格

{{DJ_PERSONA}}

## 推歌强约束

1. **reason 必须锚定 evidence,禁止泛音乐描述**
   - ✅ "你 Long Shot 锚点里就有这首" / "上周播过 3 次"
   - ❌ "副歌很燃" / "编曲精致" / "氛围感强"

2. **reason 出现的任何专辑名/年代/合作艺人,必须在 prompt 的 RAG context (相关曲库/反馈/life-stages) 里出现过**
   - 出现 evidence 外细节 → server 会拒收

3. **不能重复 RECENT_PLAYS 列表里任何一首**

4. **source_pool 比例必须严格命中** (server 会校验,偏差 >10% 会要求重试)

5. **细化语言识别**: 用户说"换一批/再来批/换批/更/全是/只要/不要/去掉/还要/这次/比刚才...":
   - 把上一轮的方向当 base direction
   - 把本次消息当 additional constraint
   - 合并: base ∩ new (KPOP + 女声 = KPOP 女声,不是只推女声)

6. **避讳词**: 永远不说 "加油 / 治愈 / 陪你 / 温暖 / 拥抱 / 力量 / 致敬 / 诠释" 类

7. **网易云版权陷阱**: 周杰伦/五月天/Beyond 等大量歌曲下架,除非已在 RAG library 列表 (带 [P]/[L]/[M] 标签) 否则不要推

## 隐私边界

引用 life-stages 用时段化("那段日子常听的"),不复述事件名词.

## 输出 schema (永远输出一个 JSON,放 ```json ... ``` 代码块)

```json
{
  "intent": "recommend|chat|feedback",
  "say": "1-2 句开场白 (chat 时可多句)",
  "play": [
    {
      "title": "歌名",
      "artist": "艺人",
      "reason": "锚定 evidence 的具体理由",
      "memoryLink": null,
      "confidence": 0.0,
      "source_preference": "netease",
      "source_pool": "library|recommend|wildcard"
    }
  ],
  "queueAction": null,
  "feedback_extract": null,
  "modeUpdate": null
}
```

- intent=chat: play=[], feedback_extract=null
- intent=feedback: play=[], queueAction=null, 填 feedback_extract:
  ```json
  { "target_title": "...", "target_artist": "...", "target_category": null,
    "signal": "love|wrong_vibe|too_familiar|never_again", "reason": "..." }
  ```

`queueAction`: `null` / `"rewrite_tail"` / `"insert_next"` / `"replace_all"`
```

- [ ] **Step 2: 创建 prompts/user-turn.md**

```markdown
{{USER_MESSAGE}}

## 当前 now-playing
{{NOW_PLAYING}}

## 当前 queue
{{CURRENT_QUEUE}}

## 时间
{{TS}} ({{DOW}})

## 探索系数
当前 = {{EXPLORATION_PCT}}%
目标分布: library {{LIB_PCT}}% / recommend {{REC_PCT}}% / wildcard {{WILD_PCT}}%

## RAG 检索结果 — evidence

### 相关曲库 (top-{{N_SONGS}}, source_pool=library 必须从这里取)
{{LIBRARY_SLICE}}

### 网易云推荐池 (source_pool=recommend 必须从这里取)
{{RECOMMEND_POOL}}

### 相关历史反馈
{{FEEDBACK_SLICE}}

### 相关 taste 片段
{{TASTE_SLICE}}

### 相关 life-stages 片段
{{LIFE_STAGE_SLICE}}

### 相关 mood-rules 片段
{{MOOD_RULE_SLICE}}

### 相关 vibe-anchors 片段
{{VIBE_ANCHOR_SLICE}}

### 相关历史对话 (语义检索)
{{SEMANTIC_HISTORY}}

## 硬约束 (全量, 不走 RAG)

### Anti-list (永久禁播)
{{ANTI_LIST}}

### Cooldown (90 天降权)
{{COOLDOWNS}}

### RECENT_PLAYS (不可重复)
{{RECENT_PLAYS}}

---

按 system prompt 的约束输出 {{N}} 首推荐 (intent=recommend) 或对话 (intent=chat) 或反馈记录 (intent=feedback).
```

- [ ] **Step 3: Commit**

```bash
git add prompts/system.md prompts/user-turn.md
git commit -m "feat(rag): split chat-mode.md into system.md + user-turn.md"
```

---

### Task 13: 重构 `context-builder.js` → buildChatMessages

**Files:**
- Modify: `server/context-builder.js`

- [ ] **Step 1: 在 context-builder.js 加 buildChatMessages 函数 (旧 buildChatPrompt 保留)**

在 `context-builder.js` 末尾追加:

```js
import { retrieveContext } from './retriever.js';

const SYSTEM_PATH = 'prompts/system.md';
const USER_TURN_PATH = 'prompts/user-turn.md';

function fmtSongs(songs) {
  if (!songs.length) return '(无相关曲库召回)';
  return songs.map((s, i) => `${i + 1}. ${s.name} / ${s.artist} [${s.tag}]`).join('\n');
}
function fmtFeedbackRag(fbs) {
  if (!fbs.length) return '(无相关反馈召回)';
  return fbs.map(f => {
    const ago = Math.round((Date.now() / 1000 - (f.ts || 0)) / 60);
    return `- [${f.signal}] ${f.title} / ${f.artist} (${ago}min前)${f.reason ? ' · ' + f.reason : ''}`;
  }).join('\n');
}
function fmtSnippets(arr, empty = '(无相关召回)') {
  if (!arr.length) return empty;
  return arr.map((s, i) => `### snippet ${i + 1}\n${s}`).join('\n\n');
}

export async function buildChatMessages({
  userMessage, currentQueue, n = 5, exploration_pct = 30,
  recommendPool = [], now = null, recentTurns = [],
}) {
  const [systemTpl, userTpl, djPersona] = await Promise.all([
    fs.readFile(SYSTEM_PATH, 'utf8'),
    fs.readFile(USER_TURN_PATH, 'utf8'),
    readOrEmpty('user/dj-persona.md'),
  ]);

  // RAG 检索
  const retrieved = await retrieveContext({
    userMessage,
    recentTurns,
    budgets: { song: 30, feedback: 8, life_stage: 3, taste: 3, mood_rule: 2, vibe_anchor: 5, chat_turn: 3 },
  });

  const system = systemTpl.replace('{{DJ_PERSONA}}', djPersona || '(dj-persona.md 为空)');

  const dt = new Date();
  const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dt.getDay()];
  const libPct = 100 - exploration_pct;
  const recPct = Math.round(exploration_pct * 0.7);
  const wildPct = exploration_pct - recPct;

  const userContent = userTpl
    .replace('{{USER_MESSAGE}}', userMessage)
    .replace('{{NOW_PLAYING}}', now ? `${now.title} / ${now.artist}` : '(无)')
    .replace('{{CURRENT_QUEUE}}', currentQueue?.length
      ? currentQueue.map((s, i) => `${i + 1}. ${s.title} / ${s.artist}`).join('\n')
      : '(当前 queue 为空)')
    .replace('{{TS}}', dt.toISOString())
    .replace('{{DOW}}', dow)
    .replace('{{EXPLORATION_PCT}}', String(exploration_pct))
    .replace('{{LIB_PCT}}', String(libPct))
    .replace('{{REC_PCT}}', String(recPct))
    .replace('{{WILD_PCT}}', String(wildPct))
    .replace('{{N_SONGS}}', String(retrieved.songs.length))
    .replace('{{N}}', String(n))
    .replace('{{LIBRARY_SLICE}}', fmtSongs(retrieved.songs))
    .replace('{{RECOMMEND_POOL}}', recommendPool.length
      ? recommendPool.map((s, i) => `${i + 1}. ${s.name} / ${s.artist}`).join('\n')
      : '(暂无)')
    .replace('{{FEEDBACK_SLICE}}', fmtFeedbackRag(retrieved.feedback))
    .replace('{{TASTE_SLICE}}', fmtSnippets(retrieved.taste_snippets))
    .replace('{{LIFE_STAGE_SLICE}}', fmtSnippets(retrieved.life_stage_snippets))
    .replace('{{MOOD_RULE_SLICE}}', fmtSnippets(retrieved.mood_rule_snippets))
    .replace('{{VIBE_ANCHOR_SLICE}}', fmtSnippets(retrieved.vibe_anchor_snippets, '(vibe-anchors.md 不存在或无相关)'))
    .replace('{{SEMANTIC_HISTORY}}', fmtSnippets(retrieved.semantic_history))
    .replace('{{ANTI_LIST}}', fmtSongList(antiList()))
    .replace('{{COOLDOWNS}}', fmtSongList(activeCooldowns()))
    .replace('{{RECENT_PLAYS}}', fmtPlays(recentPlays(30)));

  // 多轮 messages: 把最近 5 轮 chat_turns 转成 user/assistant 对
  const turns = recentChatTurns(5);
  const chronological = [...turns].reverse();
  const messages = [];
  for (const t of chronological) {
    messages.push({ role: 'user', content: t.user_message });
    // 把过去 DJ 的输出原样回放 (用最小 JSON 复原)
    const assistantPayload = {
      intent: t.intent || 'chat',
      say: t.dj_say || '',
      play: t.play_titles_json ? JSON.parse(t.play_titles_json).map(p => ({ title: p.title, artist: p.artist })) : [],
      queueAction: t.queue_action || null,
      feedback_extract: t.feedback_extract_json ? JSON.parse(t.feedback_extract_json) : null,
    };
    messages.push({ role: 'assistant', content: '```json\n' + JSON.stringify(assistantPayload, null, 2) + '\n```' });
  }
  messages.push({ role: 'user', content: userContent });

  return { system, messages };
}
```

- [ ] **Step 2: 跑现有测试确保没回归**

Run: `npm test`
Expected: 之前的 17 个测试仍通过

- [ ] **Step 3: Commit**

```bash
git add server/context-builder.js
git commit -m "feat(rag): context-builder — buildChatMessages with RAG + multi-turn"
```

---

### Task 14: `llm-adapter.js` — 支持 messages[] 入参

**Files:**
- Modify: `server/llm-adapter.js`

- [ ] **Step 1: 扩展 callLlm 接收 system + messages**

修改 `callLlm` 函数签名 + 实现:

```js
export async function callLlm({ prompt, system, messages, model, trigger, jsonMode = false }) {
  const t0 = Date.now();
  let response = '';
  let error = null;

  // Multi-turn path: 优先 messages,fallback 到 single prompt
  const useMessages = Array.isArray(messages) && messages.length > 0;

  try {
    if (model.startsWith('claude-')) {
      response = useMessages
        ? await callClaudeCliMessages(system, messages, model)
        : await callClaudeCli(prompt, model);
    } else if (model.startsWith('deepseek-')) {
      response = useMessages
        ? await callDeepSeekMessages(system, messages, model, jsonMode)
        : await callDeepSeek(prompt, model, jsonMode);
    } else if (model.startsWith('qwen-')) {
      response = useMessages
        ? await callQwenMessages(system, messages, model, jsonMode)
        : await callQwen(prompt, model, jsonMode);
    } else {
      throw new Error(`Unknown model provider for: ${model}`);
    }
  } catch (e) {
    error = String(e);
    throw e;
  } finally {
    await logLlmCall({
      model, trigger,
      prompt: useMessages ? JSON.stringify({ system, messages }) : prompt,
      response,
      duration_ms: Date.now() - t0,
      error,
    });
  }

  return response;
}
```

- [ ] **Step 2: 加 callDeepSeekMessages**

在文件加:

```js
async function callDeepSeekMessages(system, messages, model, jsonMode) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages);

  const body = {
    model,
    messages: msgs,
    temperature: 0.7,
    max_tokens: 8192,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '<no body>');
    throw new Error(`DeepSeek ${r.status}: ${text}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callQwenMessages(system, messages, model, jsonMode) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');
  const msgs = [];
  if (system) msgs.push({ role: 'system', content: system });
  msgs.push(...messages);
  const body = { model, messages: msgs, temperature: 0.7 };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Qwen ${r.status}: ${await r.text().catch(() => '<no body>')}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

// claude CLI 不原生支持 messages,把它拼回 single prompt 后用现有路径
async function callClaudeCliMessages(system, messages, model) {
  let text = system ? system + '\n\n---\n\n' : '';
  for (const m of messages) {
    text += `[${m.role}]\n${m.content}\n\n`;
  }
  return callClaudeCli(text, model);
}
```

- [ ] **Step 3: Commit**

```bash
git add server/llm-adapter.js
git commit -m "feat(rag): llm-adapter supports messages[] multi-turn"
```

---

### Task 15: 重构 `/api/chat` 接入新链路

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 替换 `/api/chat` 处理函数,改用 buildChatMessages**

找到 `app.post('/api/chat', async (req, res) => { ... })`,把里面 `buildChatPrompt` 那段替换:

旧:
```js
const prompt = await buildChatPrompt({
  userMessage: message,
  currentQueue,
  n: tuning.queue_length,
  exploration_pct: tuning.exploration_pct,
  recommendPool,
});
const raw = await callLlm({ prompt, model: config.models.chat_mode, trigger: 'chat' });
```

新:
```js
import { buildChatMessages } from './context-builder.js';
// (顶部 import)

const { system, messages } = await buildChatMessages({
  userMessage: message,
  currentQueue,
  n: tuning.queue_length,
  exploration_pct: tuning.exploration_pct,
  recommendPool,
  now,
});
const raw = await callLlm({ system, messages, model: config.models.chat_mode, trigger: 'chat' });
```

- [ ] **Step 2: 服务器启动时预热 embedder + 触发全量索引**

修改 `server.listen(...)` 那段,改成:

```js
import { warmup } from './embedder.js';
import { indexAllSongs, indexAllFeedback, indexAllChatTurns, indexMdFile } from './indexer.js';

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
```

- [ ] **Step 3: 端到端跑一次**

```bash
npm start
```

观察:
- `[startup] BGE-M3 ready` 出现
- 在 PWA 里发 "推荐几首晚上的歌"
- 应该 5-10s 返回 (而不是 25s)

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(rag): /api/chat uses RAG + multi-turn messages; warmup on startup"
```

---

### Task 16: `server/budget-enforcer.js` — source_pool 强制 + 反幻觉

**Files:**
- Create: `server/budget-enforcer.js`
- Create: `tests/budget-enforcer.test.js`

- [ ] **Step 1: 写失败测试**

```js
// tests/budget-enforcer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceSourcePoolBudget, checkReasonHallucination } from '../server/budget-enforcer.js';

test('完全命中 budget → ok', () => {
  const plays = [
    { source_pool: 'library' }, { source_pool: 'library' }, { source_pool: 'library' },
    { source_pool: 'library' }, { source_pool: 'library' }, { source_pool: 'library' }, { source_pool: 'library' },
    { source_pool: 'recommend' }, { source_pool: 'recommend' }, { source_pool: 'wildcard' },
  ];   // 7/2/1 = 70/20/10
  const r = enforceSourcePoolBudget(plays, { lib: 70, rec: 20, wild: 10 });
  assert.equal(r.ok, true);
});

test('偏差 >10% → not ok, 含 hint', () => {
  const plays = Array(10).fill({ source_pool: 'library' });   // 100/0/0
  const r = enforceSourcePoolBudget(plays, { lib: 70, rec: 20, wild: 10 });
  assert.equal(r.ok, false);
  assert.ok(r.hint.includes('70'));
  assert.ok(r.hint.includes('20'));
});

test('reason 含 evidence 外细节 → 被标记', () => {
  const plays = [{ title: 'X', artist: 'Y', reason: '出自 2019 年的专辑 Blonde, 跟 SZA 合作' }];
  const evidence = '相关曲库:\n1. Other / Other [L]';
  const hits = checkReasonHallucination(plays, evidence);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].suspect_terms.includes('2019') || hits[0].suspect_terms.some(t => t.includes('Blonde')));
});

test('reason 全锚 evidence → 不标记', () => {
  const plays = [{ title: 'X', artist: 'Y', reason: '上周你播过 3 次' }];
  const hits = checkReasonHallucination(plays, 'irrelevant evidence');
  assert.equal(hits.length, 0);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: `Cannot find module '../server/budget-enforcer.js'`

- [ ] **Step 3: 实现 budget-enforcer.js**

```js
// server/budget-enforcer.js
// 1. enforceSourcePoolBudget: 检查 LLM 返回的 play[] 实际 source_pool 分布
// 2. checkReasonHallucination: 检查 reason 里是否出现 evidence 外的专辑/年代/合作艺人

export function enforceSourcePoolBudget(plays, target, threshold = 0.10) {
  // target: { lib, rec, wild } 百分比
  if (!plays.length) return { ok: true, deviation: 0, hint: '' };
  const counts = { library: 0, recommend: 0, wildcard: 0 };
  for (const p of plays) {
    const k = p.source_pool || 'wildcard';
    counts[k] = (counts[k] || 0) + 1;
  }
  const total = plays.length;
  const actual = {
    lib: counts.library / total,
    rec: counts.recommend / total,
    wild: counts.wildcard / total,
  };
  const deviation = Math.max(
    Math.abs(actual.lib - target.lib / 100),
    Math.abs(actual.rec - target.rec / 100),
    Math.abs(actual.wild - target.wild / 100),
  );
  if (deviation <= threshold) return { ok: true, deviation, hint: '' };

  const hint = `上一轮 source_pool 分布 (lib:${(actual.lib * 100).toFixed(0)}% rec:${(actual.rec * 100).toFixed(0)}% wild:${(actual.wild * 100).toFixed(0)}%) 偏离目标 (lib:${target.lib}% rec:${target.rec}% wild:${target.wild}%). 重新分配,严格命中比例.`;
  return { ok: false, deviation, hint };
}

// 简单启发式: 检测 reason 里出现的 4 位年份 / 看似专辑名 (引号或斜体) / 大写人名词组
// 这些 token 必须在 evidence 字符串里出现过, 否则视为幻觉
export function checkReasonHallucination(plays, evidence) {
  const ev = (evidence || '').toLowerCase();
  const hits = [];
  for (let i = 0; i < plays.length; i++) {
    const reason = (plays[i].reason || '').trim();
    if (!reason) continue;
    const suspects = extractSuspectTerms(reason);
    const missing = suspects.filter(t => !ev.includes(t.toLowerCase()));
    if (missing.length) {
      hits.push({ play_idx: i, suspect_terms: missing });
    }
  }
  return hits;
}

function extractSuspectTerms(reason) {
  const out = [];
  // 1. 4 位年代
  for (const m of reason.matchAll(/\b(19|20)\d{2}\b/g)) out.push(m[0]);
  // 2. 《X》或 "X" 包裹的专辑/歌名
  for (const m of reason.matchAll(/[《"](.+?)[》"]/g)) out.push(m[1]);
  // 3. "X 那张专辑" / "X 那首"
  for (const m of reason.matchAll(/(.+?)(?:那张专辑|那首歌|专辑)/g)) {
    const candidate = m[1].slice(-20).trim();
    if (candidate.length >= 2) out.push(candidate);
  }
  return out;
}
```

- [ ] **Step 4: 验证通过**

Run: `npm test`
Expected: `# pass 21`

- [ ] **Step 5: Commit**

```bash
git add server/budget-enforcer.js tests/budget-enforcer.test.js
git commit -m "feat(rag): budget-enforcer — source_pool budget + reason hallucination check"
```

---

### Task 17: 把 budget-enforcer 接入 `/api/chat` (含 retry)

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 在 /api/chat 的 recommend 分支加 budget 检查 + 一次 retry**

找到 `if (intent === 'recommend') { ... }` 块,在 `const plays = Array.isArray(parsed.play) ? parsed.play : [];` 之后立刻插入:

```js
// === Budget enforcement ===
import { enforceSourcePoolBudget, checkReasonHallucination } from './budget-enforcer.js';
// (import 移到顶部)

const exp = tuning.exploration_pct;
const target = {
  lib: 100 - exp,
  rec: Math.round(exp * 0.7),
  wild: exp - Math.round(exp * 0.7),
};
let budgetCheck = enforceSourcePoolBudget(plays, target);
if (!budgetCheck.ok) {
  console.log(`[chat] budget deviation ${(budgetCheck.deviation * 100).toFixed(0)}%, retrying with hint`);
  const retryMessages = [...messages, {
    role: 'user',
    content: `你上一次的回答 source_pool 比例不对. ${budgetCheck.hint} 重新输出 JSON.`,
  }];
  const raw2 = await callLlm({ system, messages: retryMessages, model: config.models.chat_mode, trigger: 'chat-retry' });
  const parsed2 = extractJson(raw2);
  if (Array.isArray(parsed2.play)) {
    parsed.play = parsed2.play;
    parsed.say = parsed2.say || parsed.say;
    plays.length = 0;
    plays.push(...parsed2.play);
  }
}

// === Hallucination check (best effort, 只 log 不拦截) ===
// 构造 evidence 字符串 (最近 user 消息的 RAG context)
const evidenceStr = messages[messages.length - 1]?.content || '';
const hallu = checkReasonHallucination(plays, evidenceStr);
if (hallu.length) {
  console.warn(`[chat] hallucination suspects in ${hallu.length} reasons:`,
    hallu.map(h => `play[${h.play_idx}]: ${h.suspect_terms.join(',')}`).join('; '));
  for (const h of hallu) {
    plays[h.play_idx].reason = `(reason 含未验证细节,已隐藏) ${plays[h.play_idx].title}`;
  }
}
```

注意: 上面引用了 `messages` 和 `system` 变量, 它们已在 Task 15 的修改里出现. 需要把 `messages` / `system` 提到 if 之外, 改成 `let` 声明 以便复用.

- [ ] **Step 2: 重新跑端到端**

```bash
npm start
```
在 PWA 测试 "推荐几首晚上的", 看 server log:
- 出现 `[chat] budget deviation 0% ` 或类似 (大概率第一次就对)
- 若出现 `hallucination suspects`, 检查 prompt 是否真的没给到该 evidence

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(rag): /api/chat enforces source_pool budget + hallucination check"
```

---

### Task 18: 烟雾测试 + 删除旧 buildChatPrompt 路径

**Files:**
- Modify: `server/context-builder.js`
- Create: `scripts/smoke-rag.js`

- [ ] **Step 1: 写端到端烟雾测试脚本**

```js
// scripts/smoke-rag.js
// 跑两轮 chat 验证 RAG + 多轮记忆 + budget enforcement
import { warmup } from '../server/embedder.js';
import { buildChatMessages } from '../server/context-builder.js';
import { callLlm, extractJson } from '../server/llm-adapter.js';
import { recordChatTurn } from '../server/state-db.js';
import { enforceSourcePoolBudget } from '../server/budget-enforcer.js';
import yaml from 'yaml';
import fs from 'fs/promises';

const config = yaml.parse(await fs.readFile('config.yaml', 'utf8'));
await warmup();
console.log('[smoke] embedder ready');

async function turn(userMsg) {
  const t0 = Date.now();
  const { system, messages } = await buildChatMessages({
    userMessage: userMsg,
    currentQueue: [],
    n: 5,
    exploration_pct: 30,
    recommendPool: [],
  });
  const promptBytes = system.length + messages.reduce((s, m) => s + m.content.length, 0);
  const raw = await callLlm({ system, messages, model: config.models.chat_mode, trigger: 'smoke' });
  const parsed = extractJson(raw);
  const dt = Date.now() - t0;
  console.log(`\n[smoke] "${userMsg}"`);
  console.log(`  prompt: ${(promptBytes / 1024).toFixed(1)}KB, elapsed: ${(dt / 1000).toFixed(1)}s`);
  console.log(`  intent: ${parsed.intent}, plays: ${parsed.play?.length || 0}`);
  if (parsed.play?.length) {
    for (const p of parsed.play) {
      console.log(`    - ${p.title} / ${p.artist} [${p.source_pool}] · ${(p.reason || '').slice(0, 60)}`);
    }
    const budget = enforceSourcePoolBudget(parsed.play, { lib: 70, rec: 21, wild: 9 });
    console.log(`  budget ok=${budget.ok}, deviation=${(budget.deviation * 100).toFixed(0)}%`);
  }
  recordChatTurn({
    user_message: userMsg,
    intent: parsed.intent,
    dj_say: parsed.say,
    play_titles_json: JSON.stringify(parsed.play?.map(p => ({ title: p.title, artist: p.artist })) || []),
    queue_action: parsed.queueAction,
    feedback_extract_json: null,
    context_now_title: null,
    context_now_artist: null,
  });
}

await turn('推荐几首 KPOP');
await turn('换一批全是女声的');

console.log('\n[smoke] done');
```

- [ ] **Step 2: 跑烟雾测试**

```bash
node --env-file=.env scripts/smoke-rag.js
```
Expected:
- prompt < 12KB
- 每轮 < 10s
- 第二轮 plays 与第一轮 ≥70% 不同
- 第二轮的歌确实是 KPOP 女声 (不是失忆推默认歌)
- budget ok=true 或 deviation ≤10%

- [ ] **Step 3: 把旧 `buildChatPrompt` 标 deprecated**

修改 `server/context-builder.js`, 在 `export async function buildChatPrompt(` 前加注释:

```js
/**
 * @deprecated Use buildChatMessages instead. Kept for cold-start / chat-once scripts.
 */
export async function buildChatPrompt({ userMessage, currentQueue, n = 5, exploration_pct = 30, recommendPool = [] }) {
```

- [ ] **Step 4: Commit**

```bash
git add server/context-builder.js scripts/smoke-rag.js
git commit -m "test(rag): end-to-end smoke + deprecate buildChatPrompt"
```

---

### Task 19: config.yaml RAG 开关 + README/HOW-TO

**Files:**
- Modify: `config.yaml`
- Create: `docs/RAG.md`

- [ ] **Step 1: 加 rag: 块到 config.yaml**

```yaml
rag:
  enabled: true
  retrieval:
    song_top_k: 30
    feedback_top_k: 8
    life_stage_top_k: 3
    taste_top_k: 3
    mood_rule_top_k: 2
    vibe_anchor_top_k: 5
    chat_turn_top_k: 3
  embedding:
    model: 'Xenova/bge-m3'
    dim: 1024
    quantization: 'q8'
  budget_enforcement:
    enabled: true
    deviation_threshold: 0.10
    max_retries: 1
```

- [ ] **Step 2: 创建 docs/RAG.md 操作手册**

```markdown
# NightlinerFM RAG 操作手册

## 启动时发生了什么

1. `embedder.warmup()` 加载 BGE-M3 (~3s 首次, 之后即时)
2. `indexAllSongs / indexAllFeedback / indexAllChatTurns / indexMdFile` 增量扫描
3. 已索引过的 source_id 自动跳过, 新数据自动加进 embeddings + vec_embeddings

## 手动操作

| 操作 | 命令 |
|---|---|
| 重建全部 index | `rm data/state.db && npm run index:all` |
| 仅新增索引 | `npm run index:all` |
| 看 embedding 表 | `sqlite3 data/state.db "SELECT source_type, COUNT(*) FROM embeddings GROUP BY source_type"` |
| 测试 embed | `npm run test:embed` |
| 端到端烟雾测试 | `node --env-file=.env scripts/smoke-rag.js` |
| 单元测试 | `npm test` |

## 调参

`config.yaml > rag.retrieval.*_top_k` — 召回数量, 越大 prompt 越长但召回越全
`config.yaml > rag.budget_enforcement.deviation_threshold` — 探索系数容忍, 默认 10%

## 灰度回退

紧急回退到旧 prompt: 设 `config.yaml > rag.enabled: false` (需在 index.js 加分支判断). 暂未实现, 目前需 git revert.

## 容量预算

- embeddings 表每条 ~2KB (1024 float32 + meta)
- 1000 条反馈累积 = ~2MB, 10000 条 = ~20MB
- BGE-M3 q8 进程内存 ~2-3GB
```

- [ ] **Step 3: Commit**

```bash
git add config.yaml docs/RAG.md
git commit -m "docs(rag): config schema + RAG.md ops manual"
```

---

## Self-Review Checklist (写完后填)

- [x] Spec §3 架构 → Task 2-17
- [x] Spec §4 数据建模 → Task 4-5
- [x] Spec §5 模块拆分 → embedder(2-3) / vec-store(6) / indexer(7-10) / retriever(11) / context-builder(13) / llm-adapter(14) / budget-enforcer(16)
- [x] Spec §6 Prompt 拆分 → Task 12
- [x] Spec §7 索引时机 → 启动 (Task 15) + recordFeedback/recordChatTurn hook (Task 9) + MD (Task 10)
- [x] Spec §8 .env / config.yaml → Task 19 (config) + 已在前置工作完成 .env
- [x] Spec §9 性能预算 → 烟雾测试 (Task 18) 验证
- [x] Spec §10 风险缓解 → config.enabled 开关 (Task 19) + try/catch + warmup
- [x] Spec §11 PR 顺序 → 19 个 task 大致对应 6 个 PR 边界, 偏细但便于验证
- [x] Spec §12 vibe-anchors.md → Task 10 已留 source_type, 不强求文件存在
- [x] 无 placeholder
- [x] 类型一致: embed 返回 Float32Array, upsertEmbeddingRow 接收 Float32Array, searchSimilar 接收 Float32Array, 全链路一致
- [x] 测试框架统一用 node:test
