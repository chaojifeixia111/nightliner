// tests/embedder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, embedBatch } from '../server/embedder.js';

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

test('embedBatch 返回相同条数 Float32Array', async () => {
  const out = await embedBatch(['夜里', 'morning run', '一个人']);
  assert.equal(out.length, 3);
  out.forEach(v => assert.equal(v.length, 1024));
});

test('embedBatch 空数组返回空', async () => {
  const out = await embedBatch([]);
  assert.deepEqual(out, []);
});
