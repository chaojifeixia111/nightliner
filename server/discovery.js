// server/discovery.js
// 发现层:把「近(像你爱的)」和「远(题材广度/榜单)」两路候选按探索档位混合,
// 用 affinity 重排到你的口味(Agency:绝不照搬网易云原序)。
import { songKey } from './explore-pool.js';
import { songWeight } from './affinity.js';

// 纯函数:混合 near/far,去重(库内/排除集/跨档),按 affinity*噪声 重排。
export function blendDiscovery({ near = [], far = [], mode, libKeys = new Set(), excludeKeys = new Set(), limit = 24, songAff, artistAff, rng = Math.random }) {
  const farFraction = (mode?.value ?? 50) / 100;
  const desiredFar = Math.round(limit * farFraction);
  const desiredNear = limit - desiredFar;
  const exclude = new Set([...libKeys, ...excludeKeys]);

  const dedup = (arr) => {
    const seen = new Set(); const out = [];
    for (const c of arr) {
      const k = songKey(c.name, c.artist);
      if (!c.name || exclude.has(k) || seen.has(k)) continue;
      seen.add(k); out.push(c);
    }
    return out;
  };
  const sortByW = (arr) => arr
    .map(c => ({ c, k: songWeight({ name: c.name, artist: c.artist }, { songAff, artistAff }) * (0.5 + rng()) }))
    .sort((a, b) => b.k - a.k)
    .map(x => x.c);

  const nearD = sortByW(dedup(near));
  const farD = sortByW(dedup(far));

  const taken = new Set();
  const pick = (arr, n) => {
    const out = [];
    for (const c of arr) {
      if (out.length >= n) break;
      const k = songKey(c.name, c.artist);
      if (taken.has(k)) continue;
      taken.add(k); out.push(c);
    }
    return out;
  };

  let out = [...pick(nearD, desiredNear), ...pick(farD, desiredFar)];
  if (out.length < limit) out = [...out, ...pick([...nearD, ...farD], limit - out.length)];
  return out.slice(0, limit);
}
