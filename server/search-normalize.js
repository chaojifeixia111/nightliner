// server/search-normalize.js
// 把 NCM 各接口返回的歌曲/歌手对象归一化成前端统一形状。纯函数,无副作用。

function artistsOf(s) {
  const arr = s.ar || s.artists || [];
  return arr.map(a => a?.name).filter(Boolean).join(' / ');
}
function picOf(s) {
  return s.al?.picUrl || s.album?.picUrl || null;
}
function toSong(s) {
  return { ncm_id: s.id, name: s.name, artist: artistsOf(s), pic_url: picOf(s) };
}

export function normalizeDailySongs(resp) {
  const songs = resp?.data?.dailySongs || [];
  return songs.map(toSong);
}
export function normalizeSearchSongs(resp) {
  const songs = resp?.result?.songs || [];
  return songs.map(toSong);
}
export function normalizeArtistSongs(resp) {
  const songs = resp?.songs || [];
  return songs.map(toSong);
}
export function normalizeSearchArtists(resp) {
  const artists = resp?.result?.artists || [];
  return artists.map(a => ({
    artist_id: a.id,
    name: a.name,
    pic_url: a.picUrl || a.img1v1Url || null,
  }));
}
