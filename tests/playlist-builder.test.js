// tests/playlist-builder.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaylist, plKey } from '../server/playlist-builder.js';

const mk = (prefix, count) =>
  Array.from({ length: count }, (_, i) => ({ ncm_id: `${prefix}${i}`, name: `${prefix}${i}`, artist: `${prefix}art${i}` }));
const cnt = (out, p) => out.filter(s => s.name.startsWith(p)).length;
const pools = () => ({ library: mk('L', 40), recommend: mk('R', 40), wildcard: mk('W', 40) });

test('plKey: 归一化大小写/空格, 取主艺人', () => {
  assert.equal(plKey({ name: 'Hi There', artist: 'A / B' }), plKey({ name: 'hi there', artist: 'a' }));
});

test('Comfort(0): 全部来自 library', () => {
  const out = buildPlaylist({ value: 0, n: 25, pools: pools() });
  assert.equal(out.length, 25);
  assert.equal(cnt(out, 'L'), 25);
});

test('Wild(100): 配方 lib1 / rec8 / wild16', () => {
  const out = buildPlaylist({ value: 100, n: 25, pools: pools() });
  assert.equal(out.length, 25);
  assert.equal(cnt(out, 'L'), 1);
  assert.equal(cnt(out, 'R'), 8);
  assert.equal(cnt(out, 'W'), 16);
});

test('Balanced(50): 配方 lib13 / rec9 / wild3(wild = 余数)', () => {
  const out = buildPlaylist({ value: 50, n: 25, pools: pools() });
  assert.equal(cnt(out, 'L'), 13);
  assert.equal(cnt(out, 'R'), 9);
  assert.equal(cnt(out, 'W'), 3);
});

test('无重复:同一首出现在两个池只取一次, 整体 key 唯一', () => {
  const dup = { ncm_id: 'x', name: 'Dup', artist: 'Z' };
  const out = buildPlaylist({
    value: 50, n: 25,
    pools: { library: [dup, ...mk('L', 40)], recommend: [dup, ...mk('R', 40)], wildcard: mk('W', 40) },
  });
  assert.ok(out.filter(s => s.name === 'Dup').length <= 1);
  const keys = out.map(plKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('excludeKeys 内的歌不出现', () => {
  const p = pools();
  const banned = plKey(p.library[0]);
  const out = buildPlaylist({ value: 0, n: 25, pools: p, excludeKeys: new Set([banned]) });
  assert.equal(out.some(s => plKey(s) === banned), false);
});

test('池子短 → 从其它池回填到 n', () => {
  const out = buildPlaylist({
    value: 0, n: 25,
    pools: { library: mk('L', 5), recommend: mk('R', 40), wildcard: mk('W', 40) },
  });
  assert.equal(out.length, 25);
  assert.equal(cnt(out, 'L'), 5);   // library 全取, 其余回填
});

test('不超过 n', () => {
  const out = buildPlaylist({ value: 50, n: 10, pools: pools() });
  assert.equal(out.length, 10);
});

test('纯函数:不改入参池', () => {
  const p = pools();
  buildPlaylist({ value: 50, n: 25, pools: p });
  assert.equal(p.library.length, 40);
  assert.equal(p.recommend.length, 40);
  assert.equal(p.wildcard.length, 40);
});

test('全空池 → []', () => {
  assert.deepEqual(buildPlaylist({ value: 50, n: 25, pools: {} }), []);
});
