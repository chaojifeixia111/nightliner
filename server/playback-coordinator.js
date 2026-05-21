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

// 检测歌名是否是 remix/cover/live 等变体版本
// 只在括号/破折号后出现关键字才算,避免误伤("Live and Let Die" 不算)
const VARIANT_PATTERN = /[\(\[（【][^)\]）】]*?(remix|cover|live|acoustic|instrumental|翻唱|纯音乐|伴奏|混音|dj版|reprise|demo|rmx|加快|降速|现场|inst\.?|清唱|重制|new version)[^)\]）】]*?[\)\]）】]|[-_]\s*(remix|cover|live|acoustic|instrumental|纯音乐|伴奏|混音|dj版|reprise|demo|rmx|加快|降速|现场|version|edit|mix)\b/i;

function isVariantTitle(title) {
  return VARIANT_PATTERN.test(title || '');
}

// 剥掉括号/破折号后缀,得到主歌名
function stripVariantSuffix(title) {
  return (title || '')
    .replace(/\s*[\(\[（【][^)\]）】]*[\)\]）】]/g, '')
    .replace(/\s*[-_]\s*(remix|cover|live|acoustic|instrumental|version|edit|mix|纯音乐|伴奏|混音|reprise).*$/i, '')
    .trim();
}

// 从 NCM 搜索结果里挑最匹配的
// 优先级:原唱 > 同名变体(只在用户明确要变体时);永不返回他人翻唱
function pickBest(searchResult, targetTitle, targetArtist) {
  const songs = searchResult?.result?.songs || [];
  if (!songs.length) return null;
  const norm = s => (s || '').toLowerCase().replace(/\s|·|・|・|\(|\)|（|）/g, '');
  const tt = norm(targetTitle);
  const targetArtistFirst = norm(targetArtist).split('/')[0];

  // 用户是不是主动想要变体版?(eg "Closer (Acoustic)")
  const userWantsVariant = isVariantTitle(targetTitle);

  // 候选池:不要变体(除非用户主动要)
  const candidates = userWantsVariant
    ? songs
    : songs.filter(s => !isVariantTitle(s.name || ''));

  if (candidates.length === 0) {
    console.log(`[playback] all results were variants for: ${targetTitle} / ${targetArtist}`);
    return null;
  }

  // 1. 严格:歌名 + 艺人都精确对上
  for (const s of candidates) {
    const n = normalizeSong(s);
    if (norm(n.name) === tt && norm(n.artistName).includes(targetArtistFirst)) {
      return s;
    }
  }

  // 2. 主歌名(剥掉后缀)精确对上 + 艺人对上 — 处理类似 "Closer (Original Mix)" 这种
  //    这里不再用 includes,改用剥后缀后的精确比较,避免 substring 误匹配
  for (const s of candidates) {
    const n = normalizeSong(s);
    const stripped = norm(stripVariantSuffix(n.name));
    if (stripped === tt && norm(n.artistName).includes(targetArtistFirst)) {
      return s;
    }
  }

  // 没找到原唱 → 不返回任何东西,这首被丢弃
  console.log(`[playback] no original version found for: ${targetTitle} / ${targetArtist}`);
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
