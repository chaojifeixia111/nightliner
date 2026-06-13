// server/playlist-builder.js
// 「点即播」歌单引擎:按探索档位配方从三个候选池随机抽样,组成一张歌单。
// 纯函数、确定性随机(可注入 rng)、不调 LLM —— 配合 Listen 页的「不想思考、随机给我」。
import { modeForValue } from './exploration-modes.js';

// 去重/排除键:归一化 歌名|主艺人(大小写/空格无关)
export function plKey(s) {
  const name = (s?.name || '').toLowerCase().replace(/\s+/g, '');
  const artist = (s?.artist || '').toLowerCase().split('/')[0].replace(/\s+/g, '');
  return `${name}|${artist}`;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 从 pool 里最多取 want 首,跳过已用 / 排除的 key(选中的计入 used)
function takeFrom(pool, want, used, exclude, rng) {
  const picked = [];
  if (want <= 0) return picked;
  for (const s of shuffle(pool, rng)) {
    if (picked.length >= want) break;
    const k = plKey(s);
    if (used.has(k) || exclude.has(k)) continue;
    used.add(k);
    picked.push(s);
  }
  return picked;
}

// 按 mode(value→档位)的 lib/rec/wild 配方从三池抽样组成 n 首。
// 某池不足 → 从所有池剩余回填到 n(宁可凑满也不返回半空)。
export function buildPlaylist({ value, n = 25, pools = {}, excludeKeys = new Set(), rng = Math.random } = {}) {
  const mode = modeForValue(value);
  const lib = pools.library || [];
  const rec = pools.recommend || [];
  const wild = pools.wildcard || [];

  const used = new Set();
  const libN = Math.round((mode.lib / 100) * n);
  const recN = Math.round((mode.rec / 100) * n);
  const wildN = Math.max(0, n - libN - recN);   // wildcard 吃余数,保证三者和 = n

  const out = [
    ...takeFrom(lib, libN, used, excludeKeys, rng),
    ...takeFrom(rec, recN, used, excludeKeys, rng),
    ...takeFrom(wild, wildN, used, excludeKeys, rng),
  ];

  // 回填:某池没凑够 → 从所有池剩余里补到 n
  if (out.length < n) {
    for (const s of shuffle([...lib, ...rec, ...wild], rng)) {
      if (out.length >= n) break;
      const k = plKey(s);
      if (used.has(k) || excludeKeys.has(k)) continue;
      used.add(k);
      out.push(s);
    }
  }

  // 整体再打散一次:避免「库内全在前、wildcard 全在后」的可预测段落
  return shuffle(out, rng);
}
