// scripts/index-all.js
// 全量索引曲库 + 反馈 + chat_turns + MD 文件到 embeddings.
// 注意: T8 只接入 songs. T9+T10 会扩展 fb/turns/MD.
import { indexAllSongs, indexAllFeedback, indexAllChatTurns } from '../server/indexer.js';
import { countEmbeddings } from '../server/state-db.js';

console.log('[index-all] start');
const t0 = Date.now();

const songStats = await indexAllSongs();
console.log(`[index-all] songs: +${songStats.added}, =${songStats.skipped}`);

const fbStats = await indexAllFeedback();
console.log(`[index-all] feedback: +${fbStats.added}, =${fbStats.skipped}`);

const turnStats = await indexAllChatTurns();
console.log(`[index-all] chat_turns: +${turnStats.added}, =${turnStats.skipped}`);

const total = countEmbeddings();
console.log(`[index-all] total embeddings in db: ${total}`);
console.log(`[index-all] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
