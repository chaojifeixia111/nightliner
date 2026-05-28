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

test('searchSimilar 返回最相近 (向量 a) 的 song', () => {
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
