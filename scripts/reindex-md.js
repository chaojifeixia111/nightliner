// scripts/reindex-md.js
// 强制重建手写 MD 的派生索引 (taste/life_stage/mood_rule/persona/vibe_anchor).
//
// 为什么需要它: indexMdFile 按 source_id (= 路径:H2标题) 跳过已索引的块, 且没有删除逻辑.
// 所以「原地改了某个 H2 段落的正文、但标题没变」时, npm run index:all 会跳过它,
// 你的编辑永远进不了 RAG. 本脚本先清掉这些 source_type 的旧 chunk, 再从当前 MD 正文
// 重新 embed, 确保编辑生效.
//
// 安全范围: 只动这 5 个手写 MD 的 source_type. 不碰 song(曲库) / feedback / chat_turn
// (运行时学习). MD 正本文件本身一个字都不会动.
import { indexMdFile } from '../server/indexer.js';
import { deleteEmbeddingsBySourceType, countEmbeddings } from '../server/state-db.js';

const MD_TARGETS = [
  ['user/taste.md', 'taste'],
  ['user/life-stages.md', 'life_stage'],
  ['user/mood-rules.md', 'mood_rule'],
  ['user/dj-persona.md', 'persona'],
  ['user/vibe-anchors.md', 'vibe_anchor'],
];

console.log('[reindex-md] start');
const t0 = Date.now();

for (const [path, type] of MD_TARGETS) {
  const removed = deleteEmbeddingsBySourceType(type);
  const s = await indexMdFile(path, type);
  console.log(`[reindex-md] ${path} (${type}): -${removed} 旧, +${s.added} 新`);
}

console.log(`[reindex-md] embeddings 总数: ${countEmbeddings()}`);
console.log(`[reindex-md] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
