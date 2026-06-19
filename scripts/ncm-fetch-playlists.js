// scripts/ncm-fetch-playlists.js
// 从 user/playlists.json 读出 netease 类种子歌单 ID,拉每个歌单的全部歌曲到 data/netease-snapshot.json
//
// 韧性:NCM → 网易云偶发 502/超时(歌单一多就容易碰上)。单个歌单失败不再中断整次刷新——
// 每个歌单重试若干次,仍失败则沿用上次快照里的旧数据(有的话),最后照常写盘。
// 全新歌单(无旧数据)拉取失败 → 跳过并以 exitCode=1 提示「再跑一次」。
import fs from 'fs/promises';
import { playlistDetail, playlistTrackAll } from '../server/ncm-client.js';

const SNAPSHOT_PATH = 'data/netease-snapshot.json';
const RETRIES = 4;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 仅对瞬时错误重试(5xx / 429 / 网络),其它(如歌单不存在)直接抛
function isTransient(e) {
  return /HTTP 5\d\d|HTTP 429|fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(e.message);
}

async function withRetry(fn, label) {
  let lastErr;
  for (let i = 1; i <= RETRIES; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < RETRIES && isTransient(e)) {
        const wait = 700 * i;
        console.log(`   ⚠ ${label} 第 ${i}/${RETRIES} 次失败(${e.message}),${wait}ms 后重试...`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function fetchPlaylist(p) {
  const detailResp = await withRetry(() => playlistDetail(p.id), `${p.label} detail`);
  const playlistName = detailResp.playlist.name;
  const trackCount = detailResp.playlist.trackCount;
  console.log(`   名称: ${playlistName}, 共 ${trackCount} 首`);

  const tracksResp = await withRetry(() => playlistTrackAll(p.id, { limit: trackCount }), `${p.label} tracks`);
  const songs = tracksResp.songs.map((s, idx) => ({
    idx,
    id: s.id,
    name: s.name,
    artists: s.ar.map(a => a.name).join(' / '),
    album: s.al?.name || '',
    duration_ms: s.dt,
  }));

  return {
    id: p.id,
    label: p.label,
    time_range: p.time_range,
    weight: p.weight,
    note: p.note,
    playlist_name_on_netease: playlistName,
    track_count_on_netease: trackCount,
    track_count_fetched: songs.length,
    songs,
  };
}

async function loadPrevSnapshot() {
  const m = new Map();
  try {
    const raw = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf8'));
    const lists = Array.isArray(raw.playlists) ? raw.playlists : Object.values(raw.playlists || {});
    for (const pl of lists) m.set(String(pl.id), pl);
  } catch { /* 没有旧快照就空着 */ }
  return m;
}

async function main() {
  const { seed_playlists } = JSON.parse(await fs.readFile('user/playlists.json', 'utf8'));
  const neteaseLists = seed_playlists.filter(p => p.source === 'netease');
  const prev = await loadPrevSnapshot();

  const snapshot = { fetched_at: new Date().toISOString(), playlists: [] };
  const staleKept = [];
  const dropped = [];

  for (const p of neteaseLists) {
    console.log(`拉歌单 ${p.id} (${p.label})...`);
    try {
      const entry = await fetchPlaylist(p);
      snapshot.playlists.push(entry);
      console.log(`   ✓ 已拉 ${entry.songs.length} 首`);
    } catch (e) {
      const fallback = prev.get(String(p.id));
      if (fallback) {
        // 沿用旧数据,但元信息(label/time_range/weight/note)跟随当前 playlists.json
        snapshot.playlists.push({
          ...fallback,
          label: p.label, time_range: p.time_range, weight: p.weight, note: p.note,
          stale: true,
        });
        staleKept.push(p.label);
        console.warn(`   ✗ ${p.label} 拉取失败(${e.message}) —— 沿用上次快照 ${fallback.songs.length} 首`);
      } else {
        dropped.push(p.label);
        console.warn(`   ✗ ${p.label} 拉取失败(${e.message}) —— 本次跳过(无旧数据可沿用)`);
      }
    }
  }

  await fs.writeFile(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\n快照已写入 ${SNAPSHOT_PATH} (${snapshot.playlists.length} 个歌单)`);
  if (staleKept.length) console.log(`⚠ 沿用旧数据(本次没拉到):${staleKept.join(', ')}`);
  if (dropped.length) {
    console.log(`⚠ 全新歌单没拉到、已跳过:${dropped.join(', ')} —— 再跑一次 npm run ncm:fetch`);
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
