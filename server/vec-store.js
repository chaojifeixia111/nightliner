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
