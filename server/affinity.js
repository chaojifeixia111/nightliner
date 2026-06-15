// server/affinity.js
// Durable taste/affinity derived ON-READ from the feedback table (single source of truth).
// love = cumulative + durable (no time decay — Elliot only loves current taste).
// wrong_vibe = negative; cooldown(too_familiar) = temporary negative; skip = NOT used here.
import db, { activeCooldowns } from './state-db.js';
import { songKey, norm } from './explore-pool.js';

const mArtist = (artist) => norm((artist || '').split('/')[0]);

export function songAffinity() {
  const rows = db.prepare(`
    SELECT song_title name, song_artist artist, COUNT(*) loves, MAX(ncm_id) ncm_id, MAX(ts) lastTs
    FROM feedback WHERE signal='love'
    GROUP BY song_title, song_artist
  `).all();
  const m = new Map();
  for (const r of rows) {
    const k = songKey(r.name, r.artist);
    const cur = m.get(k);
    if (cur) {
      cur.loves += r.loves;
      if (r.ncm_id != null) cur.ncm_id = r.ncm_id;
      cur.lastTs = Math.max(cur.lastTs || 0, r.lastTs || 0);
    } else {
      m.set(k, { name: r.name, artist: r.artist, loves: r.loves, ncm_id: r.ncm_id, lastTs: r.lastTs });
    }
  }
  return m;
}

export function artistAffinity() {
  const rows = db.prepare(`SELECT song_artist artist, COUNT(*) loves FROM feedback WHERE signal='love' GROUP BY song_artist`).all();
  const m = new Map();
  for (const r of rows) {
    const k = mArtist(r.artist);
    if (!k) continue;
    const cur = m.get(k) || { loves: 0, name: (r.artist || '').split('/')[0].trim() };
    cur.loves += r.loves;
    m.set(k, cur);
  }
  return m;
}

// NOTE for batch callers (ranking loops): build ctx ONCE and pass it in —
//   const ctx = { songAff: songAffinity(), artistAff: artistAffinity() };
// Calling songWeight(song) without ctx re-scans the feedback table on every call.
// Weight for a candidate song. Base 1 so unloved songs still appear; loves stack.
export function songWeight(song, ctx) {
  const songAff = ctx?.songAff || songAffinity();
  const artistAff = ctx?.artistAff || artistAffinity();
  const s = songAff.get(songKey(song.name || song.title, song.artist));
  const a = artistAff.get(mArtist(song.artist));
  return 1 + (s?.loves || 0) + 0.5 * (a?.loves || 0);
}

export function lovedSeeds(limit = 6) {
  return db.prepare(`
    SELECT song_title name, song_artist artist, MAX(ncm_id) ncm_id, COUNT(*) loves, MAX(ts) lastTs
    FROM feedback WHERE signal='love' AND ncm_id IS NOT NULL
    GROUP BY song_title, song_artist
    ORDER BY lastTs DESC, loves DESC
    LIMIT ?
  `).all(limit).map(r => ({ ncm_id: r.ncm_id, name: r.name, artist: r.artist }));
}

export function graduatedLibrary(libKeySet) {
  return db.prepare(`
    SELECT song_title name, song_artist artist, MAX(ncm_id) ncm_id
    FROM feedback WHERE signal='love' AND ncm_id IS NOT NULL
    GROUP BY song_title, song_artist
  `).all().filter(r => !libKeySet.has(songKey(r.name, r.artist)))
    .map(r => ({ ncm_id: r.ncm_id, name: r.name, artist: r.artist }));
}

// wrong_vibe songs + active cooldown songs as a Set of songKey.
export function negativeKeys() {
  const keys = new Set();
  for (const r of negativeSongs()) keys.add(songKey(r.song_title, r.song_artist));
  return keys;
}

// raw negatives (so callers can re-key with their own normalizer, e.g. plKey).
export function negativeSongs() {
  const out = db.prepare(`SELECT song_title, song_artist FROM feedback WHERE signal='wrong_vibe'`).all();
  for (const c of activeCooldowns()) out.push({ song_title: c.song_title, song_artist: c.song_artist });
  return out;
}

// Used by the chat path's avoid-list (Task 6): wrong_vibe songs the DJ should not re-recommend.
export function wrongVibeSongs() {
  return db.prepare(`SELECT song_title, song_artist FROM feedback WHERE signal='wrong_vibe'`).all();
}

// Deterministic "current taste" view for the prompt (replaces never-built LLM consolidation).
export function liveTasteBlock() {
  const artists = [...artistAffinity().values()].sort((a, b) => b.loves - a.loves).slice(0, 8);
  const recent = db.prepare(`
    SELECT song_title, song_artist, COUNT(*) loves, MAX(ts) lastTs
    FROM feedback WHERE signal='love'
    GROUP BY song_title, song_artist ORDER BY lastTs DESC LIMIT 12
  `).all();
  if (!artists.length && !recent.length) return '(还没有 love 反馈积累 —— 暂以静态档案为准)';
  const artistLine = artists.length
    ? '最常 love 的艺人:' + artists.map(a => `${a.name}${a.loves > 1 ? `(${a.loves})` : ''}`).join('、')
    : '';
  const songLine = recent.length
    ? '最近 love 的歌:' + recent.map(r => `${r.song_title} / ${r.song_artist}`).join(' · ')
    : '';
  return [artistLine, songLine].filter(Boolean).join('\n');
}
