// server/playback-coordinator.js
// 把 Claude 输出的 play[] 解析成可播放的网易云直链。搜不到的从 queue 删除。
import { cloudsearch, songDetail, songUrl } from './ncm-client.js';
import yaml from 'yaml';
import fs from 'fs/promises';

let _config = null;
async function getConfig() {
  if (!_config) {
    _config = yaml.parse(await fs.readFile('config.yaml', 'utf8'));
  }
  return _config;
}

// Normalize a song object from either cloudsearch (ar/al) or legacy search (artists/album) shape
function normalizeSong(s) {
  const artistName = s.ar
    ? s.ar.map(a => a.name).join(' / ')
    : (s.artists || []).map(a => a.name).join(' / ');
  const picUrl = s.al?.picUrl || s.album?.picUrl || null;
  const duration = s.dt ?? s.duration ?? 0;
  return { id: s.id, name: s.name, artistName, picUrl, duration };
}

// 从 NCM 搜索结果里挑最匹配的(歌名 + 艺人)
function pickBest(searchResult, targetTitle, targetArtist) {
  // cloudsearch returns result.songs; legacy search also returns result.songs
  const songs = searchResult?.result?.songs || [];
  if (!songs.length) return null;
  const norm = s => (s || '').toLowerCase().replace(/\s|·|・|・|\(|\)|（|）/g, '');
  const tt = norm(targetTitle);
  const ta = norm(targetArtist);
  for (const s of songs) {
    const normalized = normalizeSong(s);
    const sName = norm(normalized.name);
    const sArtist = norm(normalized.artistName);
    if (sName === tt && sArtist.includes(norm(ta.split('/')[0]))) return s;
  }
  // 兜底:第一个名字命中的
  for (const s of songs) {
    if (norm(s.name) === tt) return s;
  }
  // 再兜底:第一条
  return songs[0];
}

// 给一个 play[],返回 [{ title, artist, ncm_id, url, duration_ms, found: true|false }, ...]
export async function resolvePlayList(plays) {
  const config = await getConfig();
  const level = config.ncm.song_url_level;

  const resolved = [];
  for (const p of plays) {
    const q = `${p.title} ${p.artist}`;
    let entry = { title: p.title, artist: p.artist, found: false };

    try {
      const sr = await cloudsearch(q, { limit: 5 });
      const best = pickBest(sr, p.title, p.artist);
      if (!best) {
        console.warn(`[playback] 未命中: ${q}`);
        resolved.push(entry);
        continue;
      }
      const norm = normalizeSong(best);
      const urlResp = await songUrl(best.id, level);
      const url = urlResp?.data?.[0]?.url;
      if (!url) {
        console.warn(`[playback] 命中但无 URL(可能仅 VIP): ${norm.name} / ${norm.artistName}`);
        resolved.push({ ...entry, ncm_id: best.id });
        continue;
      }

      // Attempt to get picUrl; fall back to song/detail if missing
      let picUrl = norm.picUrl;
      if (!picUrl) {
        try {
          const detail = await songDetail([best.id]);
          picUrl = detail?.songs?.[0]?.al?.picUrl || null;
        } catch {
          picUrl = null;
        }
      }
      if (!picUrl) {
        console.log(`[playback] no cover for: ${norm.name}`);
      }

      resolved.push({
        ...entry,
        ncm_id: best.id,
        url,
        duration_ms: norm.duration,
        ncm_name: norm.name,
        ncm_artist: norm.artistName,
        pic_url: picUrl,
        found: true,
      });
    } catch (e) {
      console.warn(`[playback] 错误 ${q}: ${e.message}`);
      resolved.push(entry);
    }
  }

  return resolved;
}
