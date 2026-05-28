// server/state-db.js
// SQLite 主库封装。schema 来自 v0.3 §9.2,只创建本月用得到的表。
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as sqliteVec from 'sqlite-vec';

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

    CREATE TABLE IF NOT EXISTS chat_turns (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      intent TEXT,
      dj_say TEXT,
      play_titles_json TEXT,
      queue_action TEXT,
      feedback_extract_json TEXT,
      context_now_title TEXT,
      context_now_artist TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_play_events_ts ON play_events(ts);
    CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);
    CREATE INDEX IF NOT EXISTS idx_chat_turns_ts ON chat_turns(ts);

    CREATE TABLE IF NOT EXISTS embeddings (
      id INTEGER PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      chunk_text TEXT NOT NULL,
      meta_json TEXT,
      ts INTEGER NOT NULL,
      UNIQUE(source_type, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
      embedding_id INTEGER PRIMARY KEY,
      embedding FLOAT[1024]
    );
  `);
}

ensureDir();
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
sqliteVec.load(db);
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

export function recordChatTurn(turn) {
  db.prepare(`
    INSERT INTO chat_turns
    (ts, user_message, intent, dj_say, play_titles_json, queue_action, feedback_extract_json, context_now_title, context_now_artist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Math.floor(Date.now() / 1000),
    turn.user_message,
    turn.intent || null,
    turn.dj_say || null,
    turn.play_titles_json || null,
    turn.queue_action || null,
    turn.feedback_extract_json || null,
    turn.context_now_title || null,
    turn.context_now_artist || null,
  );
}

export function recentChatTurns(limit = 10) {
  return db.prepare(`SELECT * FROM chat_turns ORDER BY ts DESC LIMIT ?`).all(limit);
}

export function feedbackStats() {
  const fb = db.prepare(`SELECT signal, COUNT(*) as count FROM feedback GROUP BY signal`).all();
  const playCount = db.prepare(`SELECT COUNT(*) as c FROM play_events`).get().c;
  const turnsCount = db.prepare(`SELECT COUNT(*) as c FROM chat_turns`).get().c;
  const out = { play_events: playCount, chat_turns: turnsCount };
  for (const row of fb) out[row.signal] = row.count;
  return out;
}

// === RAG embeddings ===

export function upsertEmbeddingRow({ source_type, source_id, chunk_text, meta, embedding }) {
  const ts = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    // 1. 主表 upsert
    const result = db.prepare(`
      INSERT INTO embeddings (source_type, source_id, chunk_text, meta_json, ts)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_type, source_id) DO UPDATE SET
        chunk_text = excluded.chunk_text,
        meta_json = excluded.meta_json,
        ts = excluded.ts
      RETURNING id
    `).get(source_type, source_id, chunk_text, JSON.stringify(meta || {}), ts);
    const id = result.id;

    // 2. vec 表 upsert (先删再插,因为 vec0 不支持 ON CONFLICT)
    // IMPORTANT: sqlite-vec vec0 requires BigInt for INTEGER primary key bind
    const idBig = BigInt(id);
    db.prepare(`DELETE FROM vec_embeddings WHERE embedding_id = ?`).run(idBig);
    db.prepare(`INSERT INTO vec_embeddings(embedding_id, embedding) VALUES (?, ?)`)
      .run(idBig, Buffer.from(embedding.buffer));

    return id;
  });
  return tx();
}

export function getEmbeddingsBySource(source_type, source_id) {
  return db.prepare(`
    SELECT * FROM embeddings WHERE source_type = ? AND source_id = ?
  `).all(source_type, source_id);
}

export function deleteEmbeddingsBySource(source_type, source_id) {
  const tx = db.transaction(() => {
    const rows = db.prepare(`SELECT id FROM embeddings WHERE source_type = ? AND source_id = ?`).all(source_type, source_id);
    for (const r of rows) {
      db.prepare(`DELETE FROM vec_embeddings WHERE embedding_id = ?`).run(BigInt(r.id));
    }
    db.prepare(`DELETE FROM embeddings WHERE source_type = ? AND source_id = ?`).run(source_type, source_id);
  });
  tx();
}

export function countEmbeddings(source_type) {
  if (source_type) {
    return db.prepare(`SELECT COUNT(*) as c FROM embeddings WHERE source_type = ?`).get(source_type).c;
  }
  return db.prepare(`SELECT COUNT(*) as c FROM embeddings`).get().c;
}

export default db;
