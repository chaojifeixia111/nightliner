// server/vec-store.js
// sqlite-vec 检索封装. 输入 query embedding (Float32Array),返回 top-K 主表 row.
import db from './state-db.js';

export function searchSimilar({ embedding, source_type, top_k = 10 }) {
  // vec0 的 kNN 是全局的(跨所有 source_type),vec 表里没有 source_type 分区列。
  // 若先取全局 top-N 再按 source_type 过滤,曲库(占语料 ~88%)会把
  // taste/life_stage/persona 等稀有类型挤出候选集 → 这些片段恒为空。
  // 修复:把 k 设为语料总量 = 对全部向量做完整距离排序,过滤 source_type 后再取 top_k,
  // 保证每种类型都拿到其真实最近邻。个人级语料(数百~数千)全量排序仅几毫秒。
  // 若日后规模到万级以上,改用 vec0 partition key(source_type)按分片检索。
  const total = db.prepare(`SELECT COUNT(*) AS c FROM embeddings`).get().c;
  const k = Math.max(total, top_k);
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
  `).all(Buffer.from(embedding.buffer), k, source_type, top_k);

  return rows.map(r => ({
    id: r.id,
    source_type: r.source_type,
    source_id: r.source_id,
    chunk_text: r.chunk_text,
    meta: r.meta_json ? JSON.parse(r.meta_json) : {},
    distance: r.distance,
  }));
}
