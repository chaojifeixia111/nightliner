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
  const { famTarget, libKeys, librarySlice = [], explorePool = [], recommendPool = [], direction = null, verbatim = false } = meta || {};
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

  // ── 第一步:方向硬约束。跑偏方向的歌:优先换成方向内候选(新→库内),都没有就**丢弃**。
  // 丢弃而非保留 → 当 queue 长度 > 该方向可用曲数时,给一批「短但全在方向内」的歌,
  // 而不是用跑偏方向的歌把 queue 凑满(用户要 Gryffin 就只给 Gryffin,宁短勿偏)。
  if (direction) {
    const kept = [];
    for (const p of plays) {
      if (matchesDir(p.title, p.artist)) { kept.push(p); continue; }
      let c = newCands.shift();
      if (c) {
        kept.push(mk(c, c.kind === 'deepcut' ? 'wildcard' : 'recommend', reasonNew(c)));
        usedKeys.add(songKey(c.title, c.artist)); offDir++; repaired++;
      } else if (libCands.length) {
        c = libCands.shift();
        kept.push(mk(c, 'library', '你收藏里符合该方向的,替掉跑偏方向的那首'));
        usedKeys.add(songKey(c.title, c.artist)); offDir++; repaired++;
      } else {
        offDir++; repaired++;  // 方向内候选枯竭 → 丢弃这首跑偏的(不 push)
      }
    }
    plays.splice(0, plays.length, ...kept);  // 原地替换内容,保持调用方的数组引用
  }

  // ── 第二步:familiar↔new 比例硬对齐 —— **有方向时也执行**(2026-06-17 起)。
  // 用方向内候选(newCands/libCands 已按 matchesDir 过滤)拉「全新」,尊重探索档位,
  // 不再「方向 turn 比例失效」;绝不跨方向。只有 verbatim(「直接/原样放每日推荐」)
  // 才整步跳过、原样保留模型选曲。
  let familiar = plays.filter(inLib).length;
  if (!verbatim) {   // 现在方向 turn 也对齐:用方向内候选拉「全新」,尊重探索档位(不再「方向 turn 失效」)
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
  }

  return { repaired, familiar, before, newCount: plays.length - familiar, offDir };
}
