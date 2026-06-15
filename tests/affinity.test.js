// tests/affinity.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import db from '../server/state-db.js';
import { songWeight, songAffinity, artistAffinity, lovedSeeds, graduatedLibrary, negativeKeys, negativeSongs, liveTasteBlock } from '../server/affinity.js';
import { songKey } from '../server/explore-pool.js';

function reset() { db.exec("DELETE FROM feedback; DELETE FROM cooldown; DELETE FROM anti_list;"); }
function fb(signal, title, artist, ncm_id) {
  db.prepare("INSERT INTO feedback (ts,song_title,song_artist,signal,ncm_id) VALUES (?,?,?,?,?)")
    .run(Math.floor(Date.now() / 1000), title, artist, signal, ncm_id ?? null);
}

test('songWeight grows with cumulative loves', () => {
  reset();
  fb('love', 'A', 'X', 1); fb('love', 'A', 'X', 1);
  const w2 = songWeight({ name: 'A', artist: 'X' });
  fb('love', 'A', 'X', 1);
  const w3 = songWeight({ name: 'A', artist: 'X' });
  assert.ok(w3 > w2, 'more loves => more weight');
  assert.ok(songWeight({ name: 'Z', artist: 'Q' }) === 1, 'unloved baseline = 1');
});

test('artistAffinity sums loves across an artist', () => {
  reset();
  fb('love', 'A', 'X', 1); fb('love', 'B', 'X', 2); fb('love', 'C', 'Y', 3);
  const a = artistAffinity();
  assert.equal(a.get('x').loves, 2);
  assert.equal(a.get('y').loves, 1);
});

test('lovedSeeds only returns loves with ncm_id', () => {
  reset();
  fb('love', 'WithId', 'X', 99);
  fb('love', 'NoId', 'Y', null);
  const seeds = lovedSeeds(10);
  assert.ok(seeds.some(s => s.ncm_id === 99));
  assert.ok(!seeds.some(s => s.name === 'NoId'));
});

test('graduatedLibrary = loved (with id) not already in library', () => {
  reset();
  fb('love', 'NewSong', 'X', 50);
  fb('love', 'OldSong', 'Y', 60);
  const libKeys = new Set([songKey('OldSong', 'Y')]);
  const grad = graduatedLibrary(libKeys);
  assert.ok(grad.some(s => s.name === 'NewSong'));
  assert.ok(!grad.some(s => s.name === 'OldSong'));
});

test('negativeKeys/negativeSongs include wrong_vibe + cooldown, not love', () => {
  reset();
  fb('love', 'Loved', 'X', 1);
  fb('wrong_vibe', 'Hated', 'Z', null);
  const keys = negativeKeys();
  assert.ok(keys.has(songKey('Hated', 'Z')));
  assert.ok(!keys.has(songKey('Loved', 'X')));
  assert.ok(negativeSongs().some(s => s.song_title === 'Hated'));
});

test('songAffinity merges case-variant rows (no lost loves)', () => {
  reset();
  fb('love', 'Run Free', 'Deep Chills', 1);
  fb('love', 'run free', 'deep chills', 1);
  const m = songAffinity();
  const entry = m.get(songKey('Run Free', 'Deep Chills'));
  assert.equal(entry.loves, 2, 'case variants combine into one entry with summed loves');
});

test('liveTasteBlock names top loved artists and recent loves', () => {
  db.exec("DELETE FROM feedback;");
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO feedback (ts,song_title,song_artist,signal) VALUES (?,?,?,?)")
    .run(Math.floor(Date.now() / 1000), 'S' + i, '徐佳莹', 'love');
  db.prepare("INSERT INTO feedback (ts,song_title,song_artist,signal) VALUES (?,?,?,?)")
    .run(Math.floor(Date.now() / 1000), 'Run Free', 'Deep Chills', 'love');
  const block = liveTasteBlock();
  assert.match(block, /徐佳莹/);
  assert.match(block, /Run Free/);
});

test('liveTasteBlock is graceful when empty', () => {
  db.exec("DELETE FROM feedback;");
  assert.equal(typeof liveTasteBlock(), 'string');
});
