// scripts/ncm-fetch-playlists.js
// 从 user/playlists.json 读出 netease 类种子歌单 ID,拉每个歌单的全部歌曲到 data/netease-snapshot.json
import fs from 'fs/promises';
import { playlistDetail, playlistTrackAll } from '../server/ncm-client.js';

async function main() {
  const playlistsRaw = await fs.readFile('user/playlists.json', 'utf8');
  const { seed_playlists } = JSON.parse(playlistsRaw);
  const neteaseLists = seed_playlists.filter(p => p.source === 'netease');

  const snapshot = { fetched_at: new Date().toISOString(), playlists: [] };

  for (const p of neteaseLists) {
    console.log(`拉歌单 ${p.id} (${p.label})...`);

    const detailResp = await playlistDetail(p.id);
    const playlistName = detailResp.playlist.name;
    const trackCount = detailResp.playlist.trackCount;
    console.log(`   名称: ${playlistName}, 共 ${trackCount} 首`);

    const tracksResp = await playlistTrackAll(p.id, { limit: trackCount });
    const songs = tracksResp.songs.map((s, idx) => ({
      idx,
      id: s.id,
      name: s.name,
      artists: s.ar.map(a => a.name).join(' / '),
      album: s.al?.name || '',
      duration_ms: s.dt,
    }));

    snapshot.playlists.push({
      id: p.id,
      label: p.label,
      time_range: p.time_range,
      weight: p.weight,
      note: p.note,
      playlist_name_on_netease: playlistName,
      track_count_on_netease: trackCount,
      track_count_fetched: songs.length,
      songs,
    });

    console.log(`   ✓ 已拉 ${songs.length} 首`);
  }

  await fs.writeFile('data/netease-snapshot.json', JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\n快照已写入 data/netease-snapshot.json (${snapshot.playlists.length} 个歌单)`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
