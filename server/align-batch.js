// server/align-batch.js
// 把模型返回的 play[] 对齐到「探索档位」的 familiar↔new 比例,并强制服从「方向」硬约束。
//
// 关键:
//  1. 方向优先(meta.direction):先把任何跑偏方向的歌换成方向内候选(优先全新,其次库内)。
//     候选池本身已在 context-builder 按方向过滤过,这里只从中取 → 绝不换上跑偏方向的歌。
//  2. 再对齐 familiar↔new 比例:不信模型自报的 source_pool,用真实曲库 libKeys 判定每首
//     是「库内」还是「全新」,确定性换槽(零延迟,不重试)。比例是软目标——方向内全新候选
//     不够时不硬凑(famTarget 在 context-builder 已相应上调),宁可多给方向内库内歌。
import { songKey } from './explore-pool.js';
import { songMatchesDirection } from './direction.js';

export function repairFamiliarNew(plays, meta) {
  const { famTarget, libKeys, librarySlice = [], explorePool = [], recommendPool = [], direction = null } = meta || {};
  if (!Array.isArray(plays) || !plays.length || !libKeys || famTarget == null) {
    return { repaired: 0, familiar: 0, before: 0, newCount: plays?.length || 0, offDir: 0 };
  }
  const inLib = (p) => libKeys.has(songKey(p.title, p.artist));
  const matchesDir = (title, artist) => songMatchesDirection(title, artist, direction);
  const usedKeys = new Set(plays.map(p => songKey(p.title, p.artist)));

  const before = plays.filter(inLib).length;
  let repaired = 0;
  let offDir = 0;

  // 全新候选(不在库、未占用、且符合方向):explore(含同艺人深挖)+ recommend
  const newCands = [...explorePool, ...recommendPool]
    .map(c => ({ title: c.name, artist: c.artist, ncm_id: c.ncm_id, kind: c.kind, via: c.via }))
    .filter(c => c.title && !libKeys.has(songKey(c.title, c.artist)) && !usedKeys.has(songKey(c.title, c.artist))
      && matchesDir(c.title, c.artist));
  // 库内候选(在库、未占用、符合方向):RAG / 方向采样得到的曲库歌
  const libCands = librarySlice
    .map(s => ({ title: s.name, artist: s.artist }))
    .filter(s => s.title && libKeys.has(songKey(s.title, s.artist)) && !usedKeys.has(songKey(s.title, s.artist))
      && matchesDir(s.title, s.artist));

  const reasonNew = (c) => c.kind === 'deepcut'
    ? `${(c.via && c.via[0]) || '同艺人'}的另一首,你大概率没听过(对齐探索比例换上)`
    : '和你口味相邻的新歌,你大概率没听过(对齐探索比例换上)';
  const mk = (c, pool, reason) => ({
    title: c.title, artist: c.artist, reason,
    memoryLink: null, confidence: 0.5, source_preference: 'netease', source_pool: pool,
  });

  // ── 第一步:方向硬约束。把跑偏方向的歌换成方向内候选(优先全新,其次库内)。
  if (direction) {
    for (let i = 0; i < plays.length; i++) {
      if (matchesDir(plays[i].title, plays[i].artist)) continue;
      let c = newCands.shift();
      let pool, reason;
      if (c) {
        pool = c.kind === 'deepcut' ? 'wildcard' : 'recommend';
        reason = reasonNew(c);
      } else if (libCands.length) {
        c = libCands.shift();
        pool = 'library';
        reason = '你收藏里符合该方向的,替掉跑偏方向的那首';
      } else {
        break;  // 方向内候选枯竭 → 尽力而为,剩下的留给模型原样(极少见)
      }
      plays[i] = mk(c, pool, reason);
      usedKeys.add(songKey(c.title, c.artist));
      offDir++; repaired++;
    }
  }

  // ── 第二步:familiar↔new 比例对齐(在方向内候选之间换;候选不够时不硬凑)。
  let familiar = plays.filter(inLib).length;

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

  return { repaired, familiar, before, newCount: plays.length - familiar, offDir };
}
