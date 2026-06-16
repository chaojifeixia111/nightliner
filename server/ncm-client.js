// server/ncm-client.js
// NeteaseCloudMusicApi 客户端封装(只封本月需要的端点)
import fs from 'fs/promises';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const COOKIE_PATH = 'data/netease-cookie.txt';

async function loadCookie() {
  try {
    return (await fs.readFile(COOKIE_PATH, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function ncmRequest(endpoint, params = {}) {
  const cookie = await loadCookie();
  const url = new URL(API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  // 双管齐下:URL 参数 + HTTP Header 都带 cookie,确保 NCM API 内部转发到网易云时能认证
  if (cookie) url.searchParams.set('cookie', cookie);
  const headers = {};
  if (cookie) headers['Cookie'] = cookie;
  const r = await fetch(url, { method: 'GET', headers });
  if (!r.ok) throw new Error(`NCM ${endpoint} HTTP ${r.status}`);
  return r.json();
}

export async function loginQrKey() {
  return ncmRequest('/login/qr/key', { timestamp: Date.now() });
}

export async function loginQrCreate(key) {
  return ncmRequest('/login/qr/create', { key, qrimg: true, timestamp: Date.now() });
}

export async function loginQrCheck(key) {
  return ncmRequest('/login/qr/check', { key, timestamp: Date.now() });
}

export async function saveCookie(cookieStr) {
  await fs.mkdir(path.dirname(COOKIE_PATH), { recursive: true });
  await fs.writeFile(COOKIE_PATH, cookieStr, 'utf8');
}

export async function search(keywords, { limit = 5 } = {}) {
  return ncmRequest('/search', { keywords, limit, type: 1 });
}

export async function cloudsearch(keywords, { limit = 5 } = {}) {
  return ncmRequest('/cloudsearch', { keywords, limit, type: 1 });
}

// 歌手搜索(cloudsearch type=100 → result.artists)
export async function searchArtists(keywords, { limit = 20 } = {}) {
  return ncmRequest('/cloudsearch', { keywords, limit, type: 100 });
}

export async function songDetail(ids) {
  return ncmRequest('/song/detail', { ids: ids.join(',') });
}

export async function songUrl(id, level = 'standard') {
  return ncmRequest('/song/url/v1', { id, level });
}

export async function playlistDetail(id) {
  return ncmRequest('/playlist/detail', { id });
}

export async function playlistTrackAll(id, { limit = 1000, offset = 0 } = {}) {
  return ncmRequest('/playlist/track/all', { id, limit, offset });
}

export async function userPlaylist(uid) {
  return ncmRequest('/user/playlist', { uid });
}

export async function recommendSongs(limit = 20) {
  return ncmRequest('/recommend/songs', { limit });
}

// 网易云"相似歌曲"——给一个 ncm_id,返回它的相似歌列表(网易自己的协同/风格相似)
export async function simiSong(id) {
  return ncmRequest('/simi/song', { id });
}

// 某艺人的热门单曲(/artist/top/song 返回约 50 首)—— 用于「同艺人深挖」候选
export async function artistTopSongs(id) {
  return ncmRequest('/artist/top/song', { id });
}

export async function personalFm() {
  return ncmRequest('/personal_fm');
}

// 歌单搜索(cloudsearch type=1000 → result.playlists)—— 题材/年代/语种发现的主力
export async function searchPlaylists(keywords, { limit = 8 } = {}) {
  return ncmRequest('/cloudsearch', { keywords, limit, type: 1000 });
}

// 相似艺人(/simi/artist → artists)—— 从「你爱的艺人」横向扩到「像他的艺人」
export async function simiArtist(id) {
  return ncmRequest('/simi/artist', { id });
}

// reserved for a future "charts" discovery booster — not yet wired into discovery.buildFarTier
// 排行榜列表(/toplist → list,每个是一张歌单 id,可再 playlistTrackAll 取曲)
export async function toplist() {
  return ncmRequest('/toplist');
}
