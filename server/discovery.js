// server/discovery.js
// 发现层:把「近(像你爱的)」和「远(题材广度/榜单)」两路候选按探索档位混合,
// 用 affinity 重排到你的口味(Agency:绝不照搬网易云原序)。
import { songKey, buildExplorePool } from './explore-pool.js';
import { songWeight, songAffinity, artistAffinity } from './affinity.js';
import * as ncm from './ncm-client.js';
import { directionQuery } from './direction.js';

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

const norm = (s) => ({ name: s.name, artist: (s.ar || s.artists || []).map(a => a?.name).filter(Boolean).join(' / '), ncm_id: s.id, kind: 'discovery' });

// 远档候选:有方向 → 歌单搜索 + 榜单;无方向 → 爱的艺人的相似艺人热门曲。
// deps 可注入(测试用 fake ncm);默认用真实 ncm-client。
export async function buildFarTier({ direction, lovedArtists = [], playlistCap = 3, perPlaylist = 20 }, deps = ncm) {
  const out = [];
  try {
    if (direction) {
      const kw = directionQuery(direction);
      const res = await deps.searchPlaylists(kw, { limit: 8 });
      const pls = (res?.result?.playlists || []).sort((a, b) => (b.playCount || 0) - (a.playCount || 0)).slice(0, playlistCap);
      const tracks = await Promise.allSettled(pls.map(p => deps.playlistTrackAll(p.id, { limit: perPlaylist })));
      for (const t of tracks) if (t.status === 'fulfilled') for (const s of (t.value?.songs || [])) out.push(norm(s));
    } else {
      for (const a of lovedArtists.slice(0, 3)) {
        try {
          const ar = await deps.searchArtists(a.name, { limit: 1 });
          const id = ar?.result?.artists?.[0]?.id;
          if (!id) continue;
          const sim = await deps.simiArtist(id);
          const simIds = (sim?.artists || []).slice(0, 3).map(x => x.id);
          const tops = await Promise.allSettled(simIds.map(sid => deps.artistTopSongs(sid)));
          for (const t of tops) if (t.status === 'fulfilled') for (const s of (t.value?.songs || []).slice(0, 5)) out.push(norm(s));
        } catch { /* one artist failing is fine */ }
      }
    }
  } catch { /* far tier is best-effort */ }
  return out;
}

// 顶层编排:near(explore-pool)+ far(buildFarTier)→ blendDiscovery。
export async function buildDiscoveryPool({ direction, mode, lovedSeeds = [], lovedArtists = [], libKeys = new Set(), excludeKeys = new Set(), limit = 24, exploreParams = {} }) {
  const near = await buildExplorePool({ seeds: lovedSeeds, excludeKeys, ...exploreParams }).catch(() => []);
  const far = mode.value > 0 ? await buildFarTier({ direction, lovedArtists }) : [];
  return blendDiscovery({ near, far, mode, libKeys, excludeKeys, limit, songAff: songAffinity(), artistAff: artistAffinity() });
}
