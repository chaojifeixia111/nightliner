// server/state-db.js
// SQLite 主库封装。schema 来自 v0.3 §9.2,只创建本月用得到的表。
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = 'data/state.db';

function ensureDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS play_events (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      source_app TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration_sec INTEGER,
      played_sec INTEGER,
      ended_reason TEXT,
      context_json TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      song_title TEXT NOT NULL,
      song_artist TEXT NOT NULL,
      signal TEXT NOT NULL,
      context_json TEXT
    );

    CREATE TABLE IF NOT EXISTS anti_list (
      id INTEGER PRIMARY KEY,
      song_title TEXT NOT NULL,
      song_artist TEXT NOT NULL,
      reason TEXT,
      ts INTEGER NOT NULL,
      scope TEXT
    );

    CREATE TABLE IF NOT EXISTS cooldown (
      id INTEGER PRIMARY KEY,
      song_title TEXT NOT NULL,
      song_artist TEXT NOT NULL,
      cooldown_until INTEGER NOT NULL,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS queues (
      id INTEGER PRIMARY KEY,
      ts_start INTEGER NOT NULL,
      ts_end INTEGER,
      mode TEXT,
      songs_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_play_events_ts ON play_events(ts);
    CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);
  `);
}

ensureDir();
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
migrate(db);

export function recordPlay(event) {
  const stmt = db.prepare(`
    INSERT INTO play_events
    (ts, source_app, title, artist, album, duration_sec, played_sec, ended_reason, context_json)
    VALUES (@ts, @source_app, @title, @artist, @album, @duration_sec, @played_sec, @ended_reason, @context_json)
  `);
  stmt.run({
    ts: event.ts || Math.floor(Date.now() / 1000),
    source_app: event.source_app || 'Nightliner-NCM',
    title: event.title,
    artist: event.artist,
    album: event.album || null,
    duration_sec: event.duration_sec || null,
    played_sec: event.played_sec || null,
    ended_reason: event.ended_reason || null,
    context_json: event.context_json ? JSON.stringify(event.context_json) : null,
  });
}

export function recordFeedback(fb) {
  db.prepare(`
    INSERT INTO feedback (ts, song_title, song_artist, signal, context_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    Math.floor(Date.now() / 1000),
    fb.song_title,
    fb.song_artist,
    fb.signal,
    fb.context_json ? JSON.stringify(fb.context_json) : null
  );

  // 'too_familiar' → 进 cooldown 90 天
  if (fb.signal === 'too_familiar') {
    const until = Math.floor(Date.now() / 1000) + 90 * 86400;
    db.prepare(`
      INSERT INTO cooldown (song_title, song_artist, cooldown_until, reason)
      VALUES (?, ?, ?, ?)
    `).run(fb.song_title, fb.song_artist, until, 'too_familiar');
  }
  // 'never_again' → 进 anti_list
  if (fb.signal === 'never_again') {
    db.prepare(`
      INSERT INTO anti_list (song_title, song_artist, reason, ts, scope)
      VALUES (?, ?, ?, ?, ?)
    `).run(fb.song_title, fb.song_artist, 'user marked never_again',
           Math.floor(Date.now() / 1000), 'song');
  }
}

export function recentPlays(limit = 30) {
  return db.prepare(`SELECT * FROM play_events ORDER BY ts DESC LIMIT ?`).all(limit);
}

export function recentFeedback(limit = 20) {
  return db.prepare(`SELECT * FROM feedback ORDER BY ts DESC LIMIT ?`).all(limit);
}

export function antiList() {
  return db.prepare(`SELECT song_title, song_artist FROM anti_list`).all();
}

export function activeCooldowns() {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT song_title, song_artist FROM cooldown WHERE cooldown_until > ?
  `).all(now);
}

export function recordQueue(queue) {
  return db.prepare(`
    INSERT INTO queues (ts_start, mode, songs_json) VALUES (?, ?, ?)
  `).run(
    Math.floor(Date.now() / 1000),
    queue.mode || 'chat',
    JSON.stringify(queue.songs)
  ).lastInsertRowid;
}

export default db;
