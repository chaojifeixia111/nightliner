// tests/queue-ops.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSong, playNow, enqueue, clearUpcoming, removeFromQueue } from '../server/queue-ops.js';

const s = (over) => ({ title: 't', artist: 'a', ncm_id: 1, url: 'u', ...over });

test('sameSong: 有 ncm_id 时按 id 比', () => {
  assert.equal(sameSong(s({ ncm_id: 1, title: 'X' }), s({ ncm_id: 1, title: 'Y' })), true);
  assert.equal(sameSong(s({ ncm_id: 1 }), s({ ncm_id: 2 })), false);
});
test('sameSong: 无 ncm_id 时按 title+artist', () => {
  assert.equal(sameSong({ title: 'T', artist: 'A' }, { title: 'T', artist: 'A' }), true);
  assert.equal(sameSong({ title: 'T', artist: 'A' }, { title: 'T', artist: 'B' }), false);
});

test('playNow: 空队列 → [song], now=song', () => {
  const r = playNow([], null, s({ ncm_id: 9 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [9]);
  assert.equal(r.now.ncm_id, 9);
});
test('playNow: 插在当前 now 之后, now=song', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const r = playNow(q, q[1], s({ ncm_id: 99 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 2, 99, 3]);
  assert.equal(r.now.ncm_id, 99);
});
test('playNow: now=null 但队列非空 → 插到队首', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  const r = playNow(q, null, s({ ncm_id: 99 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [99, 1, 2]);
  assert.equal(r.now.ncm_id, 99);
});
test('playNow: 不修改入参队列(纯函数)', () => {
  const q = [s({ ncm_id: 1 })];
  playNow(q, q[0], s({ ncm_id: 2 }));
  assert.equal(q.length, 1);
});

test('enqueue: 追加到末尾, now 不变', () => {
  const q = [s({ ncm_id: 1 })];
  const r = enqueue(q, q[0], s({ ncm_id: 2 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 2]);
  assert.equal(r.now.ncm_id, 1);
});
test('enqueue: now 为空时 → now=song(开始播)', () => {
  const r = enqueue([], null, s({ ncm_id: 7 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [7]);
  assert.equal(r.now.ncm_id, 7);
});

test('clearUpcoming: 保留正在播的歌, 其余清空', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const r = clearUpcoming(q, q[1]);
  assert.deepEqual(r.queue.map(x => x.ncm_id), [2]);
  assert.equal(r.now.ncm_id, 2);
});
test('clearUpcoming: now=null → 全清', () => {
  const r = clearUpcoming([s({ ncm_id: 1 })], null);
  assert.deepEqual(r.queue, []);
  assert.equal(r.now, null);
});
test('clearUpcoming: now 不在队列里也保留为唯一一项', () => {
  const r = clearUpcoming([s({ ncm_id: 1 })], s({ ncm_id: 99 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [99]);
  assert.equal(r.now.ncm_id, 99);
});
test('clearUpcoming: 不修改入参队列(纯函数)', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  clearUpcoming(q, q[0]);
  assert.equal(q.length, 2);
});

test('removeFromQueue: 移除指定的待播歌', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const r = removeFromQueue(q, q[0], s({ ncm_id: 2 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 3]);
  assert.equal(r.now.ncm_id, 1);
});
test('removeFromQueue: 正在播的歌不可移除(保护 now)', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  const r = removeFromQueue(q, q[0], s({ ncm_id: 1 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 2]);
  assert.equal(r.now.ncm_id, 1);
});
test('removeFromQueue: 不在队列里 → 原样返回', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  const r = removeFromQueue(q, q[0], s({ ncm_id: 99 }));
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 2]);
});
test('removeFromQueue: 不修改入参队列(纯函数)', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  removeFromQueue(q, q[0], s({ ncm_id: 2 }));
  assert.equal(q.length, 2);
});
