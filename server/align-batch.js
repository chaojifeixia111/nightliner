// server/align-batch.js
// 把模型返回的 play[] 对齐到「探索档位」的 familiar↔new 硬比例。
//
// 关键:不信模型自报的 source_pool,而是用真实曲库 libKeys 判定每首是「库内(familiar)」
// 还是「全新(new)」,然后多退少补 —— 确定性换槽,不重试(零延迟)。换上来的歌从手边
// 已有的候选池里取(库内← RAG library slice;全新← explore + recommend 池),配简短 reason。
// 这就是给用户的「硬对齐」保证:无论模型怎么挑,本批库内/全新数量都会落到档位指定值
// (除非候选池供给不足,那时尽力而为并如实记录)。
import { songKey } from './explore-pool.js';

export function repairFamiliarNew(plays, meta) {
  const { famTarget, libKeys, librarySlice = [], explorePool = [], recommendPool = [] } = meta || {};
  if (!Array.isArray(plays) || !plays.length || !libKeys || famTarget == null) {
    return { repaired: 0, familiar: 0, before: 0, newCount: plays?.length || 0 };
  }
  const inLib = (p) => libKeys.has(songKey(p.title, p.artist));
  const usedKeys = new Set(plays.map(p => songKey(p.title, p.artist)));

  const before = plays.filter(inLib).length;
  let familiar = before;
  let repaired = 0;

  // 全新候选(不在库、未占用):explore(含同艺人深挖)+ recommend
  const newCands = [...explorePool, ...recommendPool]
    .map(c => ({ title: c.name, artist: c.artist, ncm_id: c.ncm_id, kind: c.kind, via: c.via }))
    .filter(c => c.title && !libKeys.has(songKey(c.title, c.artist)) && !usedKeys.has(songKey(c.title, c.artist)));
  // 库内候选:RAG 召回的曲库歌(未占用)
  const libCands = librarySlice
    .map(s => ({ title: s.name, artist: s.artist }))
    .filter(s => s.title && libKeys.has(songKey(s.title, s.artist)) && !usedKeys.has(songKey(s.title, s.artist)));

  const reasonNew = (c) => c.kind === 'deepcut'
    ? `${(c.via && c.via[0]) || '同艺人'}的另一首,你大概率没听过(对齐探索比例换上)`
    : '和你口味相邻的新歌,你大概率没听过(对齐探索比例换上)';
  const mk = (c, pool, reason) => ({
    title: c.title, artist: c.artist, reason,
    memoryLink: null, confidence: 0.5, source_preference: 'netease', source_pool: pool,
  });

  // 库内太多 → 把多出来的库内歌换成全新候选
  while (familiar > famTarget && newCands.length) {
    const idx = plays.findIndex(inLib);
    if (idx < 0) break;
    const c = newCands.shift();
    plays[idx] = mk(c, c.kind === 'deepcut' ? 'wildcard' : 'recommend', reasonNew(c));
    usedKeys.add(songKey(c.title, c.artist));
    familiar--; repaired++;
  }
  // 库内太少 → 把多出来的全新歌换成库内候选
  while (familiar < famTarget && libCands.length) {
    const idx = plays.findIndex(p => !inLib(p));
    if (idx < 0) break;
    const c = libCands.shift();
    plays[idx] = mk(c, 'library', '你收藏里的,对齐熟悉比例换上');
    usedKeys.add(songKey(c.title, c.artist));
    familiar++; repaired++;
  }

  return { repaired, familiar, before, newCount: plays.length - familiar };
}
