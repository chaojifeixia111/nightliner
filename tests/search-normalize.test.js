// tests/search-normalize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDailySongs, normalizeSearchSongs, normalizeSearchArtists, normalizeArtistSongs,
} from '../server/search-normalize.js';

test('normalizeDailySongs: dailySongs → song 形状', () => {
  const data = { data: { dailySongs: [
    { id: 3, name: 'C', ar: [{ name: 'Y' }, { name: 'Z' }], al: { picUrl: 'p3' } },
  ] } };
  assert.deepEqual(normalizeDailySongs(data), [
    { ncm_id: 3, name: 'C', artist: 'Y / Z', pic_url: 'p3' },
  ]);
});

test('normalizeDailySongs: 空/缺字段 → []', () => {
  assert.deepEqual(normalizeDailySongs(null), []);
  assert.deepEqual(normalizeDailySongs({ data: {} }), []);
});

test('normalizeSearchSongs: cloudsearch songs(ar/al)', () => {
  const r = { result: { songs: [
    { id: 1, name: 'A', ar: [{ name: 'X' }], al: { picUrl: 'p' } },
  ] } };
  assert.deepEqual(normalizeSearchSongs(r), [
    { ncm_id: 1, name: 'A', artist: 'X', pic_url: 'p' },
  ]);
});

test('normalizeSearchSongs: 旧 artists/album 形状也兼容', () => {
  const r = { result: { songs: [
    { id: 2, name: 'B', artists: [{ name: 'W' }], album: { picUrl: 'q' } },
  ] } };
  assert.deepEqual(normalizeSearchSongs(r), [
    { ncm_id: 2, name: 'B', artist: 'W', pic_url: 'q' },
  ]);
});

test('normalizeSearchArtists: artists(picUrl 优先, 退 img1v1Url)', () => {
  const r = { result: { artists: [
    { id: 9, name: 'X', picUrl: 'pp' },
    { id: 10, name: 'Y', img1v1Url: 'qq' },
  ] } };
  assert.deepEqual(normalizeSearchArtists(r), [
    { artist_id: 9, name: 'X', pic_url: 'pp' },
    { artist_id: 10, name: 'Y', pic_url: 'qq' },
  ]);
});

test('normalizeArtistSongs: /artist/top/song songs', () => {
  const r = { songs: [{ id: 5, name: 'D', ar: [{ name: 'M' }], al: { picUrl: 'p5' } }] };
  assert.deepEqual(normalizeArtistSongs(r), [
    { ncm_id: 5, name: 'D', artist: 'M', pic_url: 'p5' },
  ]);
});

test('全部入口对空输入安全', () => {
  assert.deepEqual(normalizeSearchSongs(null), []);
  assert.deepEqual(normalizeSearchArtists(undefined), []);
  assert.deepEqual(normalizeArtistSongs({}), []);
});
