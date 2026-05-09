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

// 从 NCM 搜索结果里挑最匹配的(歌名 + 艺人都要对)
// 重要:不做"只匹配歌名"的兜底,否则下架歌会被翻唱版替代(如周杰伦无版权 → 抓到他人翻唱)
function pickBest(searchResult, targetTitle, targetArtist) {
  const songs = searchResult?.result?.songs || [];
  if (!songs.length) return null;
  const norm = s => (s || '').toLowerCase().replace(/\s|·|・|・|\(|\)|（|）/g, '');
  const tt = norm(targetTitle);
  const targetArtistFirst = norm(targetArtist).split('/')[0];

  // 1. 严格:歌名 + 艺人都对得上
  for (const s of songs) {
    const n = normalizeSong(s);
    if (norm(n.name) === tt && norm(n.artistName).includes(targetArtistFirst)) {
      return s;
    }
  }

  // 2. 宽松:歌名包含目标(处理 remix/feat 等后缀变体) + 艺人对得上
  for (const s of songs) {
    const n = normalizeSong(s);
    if (norm(n.name).includes(tt) && norm(n.artistName).includes(targetArtistFirst)) {
      return s;
    }
  }

  // 没找到原唱 → 不要推翻唱
  return null;
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
      const data0 = urlResp?.data?.[0];
      const url = data0?.url;
      if (!url) {
        // 详细诊断:fee=1=VIP独享,fee=4=专辑数字售卖,code 非 200 = 鉴权问题
        const diag = {
          fee: data0?.fee,
          code: data0?.code,
          freeTrial: data0?.freeTrialPrivilege?.resConsumable,
          level: data0?.level,
        };
        console.warn(`[playback] 命中但无 URL: ${norm.name} / ${norm.artistName} | ${JSON.stringify(diag)}`);
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
