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
