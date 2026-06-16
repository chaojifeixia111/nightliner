// tests/discovery.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendDiscovery } from '../server/discovery.js';
import { songKey } from '../server/explore-pool.js';

const near = [{ name: 'N1', artist: 'a' }, { name: 'N2', artist: 'b' }, { name: 'N3', artist: 'c' }];
const far = [{ name: 'F1', artist: 'x' }, { name: 'F2', artist: 'y' }, { name: 'F3', artist: 'z' }];
const mode = (v) => ({ value: v });
const emptyAff = new Map();

test('Comfort (value 0) → all near, no far', () => {
  const out = blendDiscovery({ near, far, mode: mode(0), limit: 3, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.equal(out.length, 3);
  assert.ok(out.every(c => c.name.startsWith('N')), 'only near-tier songs');
});

test('Wild (value 100) → all far', () => {
  const out = blendDiscovery({ near, far, mode: mode(100), limit: 3, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.ok(out.every(c => c.name.startsWith('F')), 'only far-tier songs');
});

test('libKeys + excludeKeys are filtered out', () => {
  const libKeys = new Set([songKey('N1', 'a')]);
  const excludeKeys = new Set([songKey('F1', 'x')]);
  const out = blendDiscovery({ near, far, mode: mode(50), limit: 6, libKeys, excludeKeys, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.ok(!out.some(c => c.name === 'N1'), 'library song excluded');
  assert.ok(!out.some(c => c.name === 'F1'), 'excluded song excluded');
});

test('cross-tier duplicate appears once', () => {
  const dup = [{ name: 'SAME', artist: 'a' }];
  const out = blendDiscovery({ near: dup, far: dup, mode: mode(50), limit: 6, songAff: emptyAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.equal(out.filter(c => c.name === 'SAME').length, 1);
});

test('affinity reranks loved songs up (deterministic rng)', () => {
  const songAff = new Map([[songKey('F3', 'z'), { loves: 50 }]]);
  const out = blendDiscovery({ near: [], far, mode: mode(100), limit: 3, songAff, artistAff: emptyAff, rng: () => 0.5 });
  assert.equal(out[0].name, 'F3', 'loved far song ranks first');
});

import { buildFarTier } from '../server/discovery.js';

// fake ncm dependency object
function fakeNcm(over = {}) {
  return {
    searchPlaylists: async () => ({ result: { playlists: [{ id: 1, name: 'pl', playCount: 9 }] } }),
    playlistTrackAll: async () => ({ songs: [{ name: 'PlSong', ar: [{ name: 'PlArtist' }], id: 11 }] }),
    searchArtists: async () => ({ result: { artists: [{ id: 7, name: 'A' }] } }),
    simiArtist: async () => ({ artists: [{ id: 8, name: 'SimA' }] }),
    artistTopSongs: async () => ({ songs: [{ name: 'TopSong', ar: [{ name: 'SimA' }], id: 22 }] }),
    toplist: async () => ({ list: [] }),
    ...over,
  };
}

test('buildFarTier(direction) pulls playlist tracks', async () => {
  const dir = { langMatch: 'chinese', gender: null, artists: [], raw: '千禧华语' };
  const far = await buildFarTier({ direction: dir, lovedArtists: [] }, fakeNcm());
  assert.ok(far.some(c => c.name === 'PlSong'), 'playlist track present');
});

test('buildFarTier(open) uses similar-artists of loved', async () => {
  const far = await buildFarTier({ direction: null, lovedArtists: [{ name: 'A' }] }, fakeNcm());
  assert.ok(far.some(c => c.name === 'TopSong'), 'similar-artist top song present');
});

test('buildFarTier swallows NetEase failures (returns array)', async () => {
  const far = await buildFarTier({ direction: null, lovedArtists: [{ name: 'A' }] },
    fakeNcm({ searchArtists: async () => { throw new Error('502'); } }));
  assert.ok(Array.isArray(far));
});
