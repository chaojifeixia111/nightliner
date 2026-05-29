// server/explore-pool.js
// 相似歌曲探索池 —— 网易云 /simi/song 只作「候选生成」层,Agent 自己做去重/过滤/打散/重排。
// 绝不照搬网易云的原始排序或 Top-K(见 memory: agent-agency-over-external-recs)。
import { simiSong } from './ncm-client.js';

// 归一化歌名/艺人,用于去重和排除集匹配
function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[（）()·・,，.。!！?？'’"]/g, '');
}

// 一首歌的去重键:主艺人 + 歌名(忽略大小写/空格/标点)
export function songKey(title, artist) {
  return `${norm(title)}|${norm(artist).split('/')[0]}`;
}

// /simi/song 返回的歌对象 → 统一形状
function normalizeSimi(s) {
  const artist = (s.artists || s.ar || []).map(a => a?.name).filter(Boolean).join(' / ');
  return { ncm_id: s.id, name: s.name, artist };
}

// Fisher–Yates:打散网易云原序,实现「随机采样而非 Top-K」
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 给若干 seed 歌(必须带数字 ncm_id),返回打散 + 过滤后的相似候选池,带 provenance。
 * Agency 在这一层体现:多种子并集、丢弃网易云原序、每种子限量、共识加权 + 随机采样。
 *
 * @param {Array<{ncm_id:number, name:string, artist:string}>} seeds 种子歌
 * @param {Set<string>} excludeKeys 需排除的 songKey(anti-list / cooldown / 最近播放 / 负反馈)
 * @param {number} perSeedCap 单个种子最多贡献几首(默认 2,避免某一首主导)
 * @param {number} limit 返回上限
 * @returns {Promise<Array<{name, artist, ncm_id, via:string[]}>>}
 */
export async function buildExplorePool({
  seeds = [],
  excludeKeys = new Set(),
  perSeedCap = 2,
  limit = 12,
} = {}) {
  // 只保留带真实数字 id 的种子(am: 开头的 Apple Music 虚拟 id 查不了 simi),并去重
  const uniqSeeds = [];
  const seenSeed = new Set();
  for (const s of seeds) {
    const id = s?.ncm_id;
    if (typeof id !== 'number' || !Number.isFinite(id)) continue;
    if (seenSeed.has(id)) continue;
    seenSeed.add(id);
    uniqSeeds.push(s);
  }
  if (!uniqSeeds.length) return [];

  // 种子自身也要排除,免得「相似歌」把种子本身推回来
  const exclude = new Set(excludeKeys);
  for (const s of uniqSeeds) exclude.add(songKey(s.name, s.artist));

  // 并行拉 simi;单个失败不影响其它
  const settled = await Promise.allSettled(uniqSeeds.map(s => simiSong(s.ncm_id)));

  const byKey = new Map(); // key → { name, artist, ncm_id, via:Set<string> }
  uniqSeeds.forEach((seed, i) => {
    const r = settled[i];
    if (r.status !== 'fulfilled') return;
    const songs = r.value?.songs || [];
    let taken = 0;
    for (const raw of shuffle(songs)) {   // 丢弃网易云原序
      if (taken >= perSeedCap) break;
      const c = normalizeSimi(raw);
      if (typeof c.ncm_id !== 'number' || !c.name) continue;
      const k = songKey(c.name, c.artist);
      if (exclude.has(k)) continue;
      if (byKey.has(k)) { byKey.get(k).via.add(seed.name); continue; } // 多种子共识,不重复占额
      byKey.set(k, { name: c.name, artist: c.artist, ncm_id: c.ncm_id, via: new Set([seed.name]) });
      taken++;
    }
  });

  // 重排信号 = 多种子共识 (via.size) + 随机噪声,绝非网易云原序 → 随机采样取 limit
  return [...byKey.values()]
    .map(c => ({
      name: c.name, artist: c.artist, ncm_id: c.ncm_id,
      via: [...c.via],
      _w: c.via.size + Math.random(),
    }))
    .sort((a, b) => b._w - a._w)
    .slice(0, limit)
    .map(({ _w, ...c }) => c);
}
