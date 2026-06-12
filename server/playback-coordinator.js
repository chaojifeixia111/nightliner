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

// 解析单首歌 → 可播放直链(独立无副作用,可并行)
async function resolveOne(p, level) {
  const q = `${p.title} ${p.artist}`;
  const entry = { title: p.title, artist: p.artist, reason: p.reason, found: false };

  try {
    const sr = await cloudsearch(q, { limit: 5 });
    const best = pickBest(sr, p.title, p.artist);
    if (!best) {
      console.warn(`[playback] 未命中: ${q}`);
      return entry;
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
      return { ...entry, ncm_id: best.id };
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

    return {
      ...entry,
      ncm_id: best.id,
      url,
      duration_ms: norm.duration,
      ncm_name: norm.name,
      ncm_artist: norm.artistName,
      pic_url: picUrl,
      found: true,
    };
  } catch (e) {
    console.warn(`[playback] 错误 ${q}: ${e.message}`);
    return entry;
  }
}

// 已知 ncm_id 时直接取直链(用于手动点播,跳过二次搜索)。
// 成功 → { ...found:true };取不到直链 → { found:false, reason:'unplayable', ncm_id }。
export async function resolveById({ ncm_id, title, artist }) {
  const config = await getConfig();
  const level = config.ncm.song_url_level;
  try {
    const urlResp = await songUrl(ncm_id, level);
    const data0 = urlResp?.data?.[0];
    const url = data0?.url;
    if (!url) return { title, artist, ncm_id, found: false, reason: 'unplayable' };

    let ncm_name = title, ncm_artist = artist, pic_url = null, duration_ms = 0;
    try {
      const detail = await songDetail([ncm_id]);
      const d = detail?.songs?.[0];
      if (d) {
        ncm_name = d.name || title;
        ncm_artist = (d.ar || []).map(a => a.name).join(' / ') || artist;
        pic_url = d.al?.picUrl || null;
        duration_ms = d.dt || 0;
      }
    } catch { /* 详情失败不致命,直链已拿到 */ }

    return { title, artist, ncm_id, url, pic_url, duration_ms, ncm_name, ncm_artist, found: true };
  } catch (e) {
    // 网络/NCM 5xx 等瞬时错误 ≠ 无版权:单独标 error,前端文案区分"重试"和"放弃"
    console.warn(`[playback] resolveById ${ncm_id} 失败: ${e.message}`);
    return { title, artist, ncm_id, found: false, reason: 'error' };
  }
}

// 给一个 play[],返回 [{ title, artist, ncm_id, url, duration_ms, found: true|false }, ...]
// 每首歌相互独立 → 并行解析(顺序由 Promise.all 保持,与 play[] 对齐)
export async function resolvePlayList(plays) {
  const config = await getConfig();
  const level = config.ncm.song_url_level;
  return Promise.all(plays.map(p => resolveOne(p, level)));
}
