// scripts/reindex-songs.js
// 重建曲库 (song) 索引:清掉所有 song embeddings,再从 data/netease-snapshot.json
// + user/apple-music-favorites-2024-2026.md 全量重 embed。导入/刷新歌单后跑这个。
//
// 为什么不能只用 index:all:indexAllSongs 按 source_id 跳过已索引,且 Apple Music 歌曲
// 用「位置序号」做虚拟 id(am:1000000...)。歌单一旦在中间增删 / 重排,位置全偏移,
// 旧 id 仍在 → index:all 跳过新内容,索引永远停在旧版本。重导歌单后必须先清 song 再重建。
// (网易云歌曲用稳定 ncm_id,本可增量,但一起重建最省心、也顺带清掉已删除的歌。)
//
// 离线操作:只读磁盘上的 snapshot + apple md,本地 BGE-M3 embed,不连 NCM。
// (拉网易云最新快照是另一步:npm run ncm:fetch,那个才需要 NCM 服务 + 有效 cookie。)
import { indexAllSongs } from '../server/indexer.js';
import { deleteEmbeddingsBySourceType, countEmbeddings } from '../server/state-db.js';

console.log('[reindex-songs] start');
const t0 = Date.now();

const removed = deleteEmbeddingsBySourceType('song');
console.log(`[reindex-songs] 清掉旧 song embeddings: ${removed}`);

const s = await indexAllSongs();
console.log(`[reindex-songs] 重建: +${s.added} 新, =${s.skipped} 跳过`);

console.log(`[reindex-songs] embeddings 总数: ${countEmbeddings()}`);
console.log(`[reindex-songs] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
