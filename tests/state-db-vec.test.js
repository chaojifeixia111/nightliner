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
  // sqlite-vec 的 vec0 主键必须用 BigInt 绑定(better-sqlite3 默认把 JS number 当 REAL)
  db.prepare("INSERT INTO vec_embeddings(embedding_id, embedding) VALUES (?, ?)")
    .run(BigInt(1), Buffer.from(vec.buffer));
  const row = db.prepare("SELECT embedding_id FROM vec_embeddings WHERE embedding_id = 1").get();
  assert.equal(row.embedding_id, 1);
});
