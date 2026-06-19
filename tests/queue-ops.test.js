// tests/queue-ops.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSong, playNow, enqueue, clearUpcoming, removeFromQueue, applyChatRecommendation, arrangeQueue, decideQueueAction } from '../server/queue-ops.js';

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

// applyChatRecommendation — 把一批 playable 应用到 queue,内含「空 playable 不清空」护栏。
test('applyChatRecommendation: 空 playable → 队列不动(防止解析空清空播放)', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  const r = applyChatRecommendation(q, q[0], [], 'replace_all');
  assert.equal(r.changed, false);
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 2]);
  assert.equal(r.now.ncm_id, 1);
});
test('applyChatRecommendation: replace_all → 整列替换, now=第一首', () => {
  const q = [s({ ncm_id: 1 })];
  const r = applyChatRecommendation(q, q[0], [s({ ncm_id: 7 }), s({ ncm_id: 8 })], 'replace_all');
  assert.equal(r.changed, true);
  assert.deepEqual(r.queue.map(x => x.ncm_id), [7, 8]);
  assert.equal(r.now.ncm_id, 7);
});
test('applyChatRecommendation: 缺省 queueAction 视为整列替换', () => {
  const r = applyChatRecommendation([s({ ncm_id: 1 })], s({ ncm_id: 1 }), [s({ ncm_id: 9 })], undefined);
  assert.deepEqual(r.queue.map(x => x.ncm_id), [9]);
  assert.equal(r.now.ncm_id, 9);
});
test('applyChatRecommendation: rewrite_tail → 保留 now, 换掉其后', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const r = applyChatRecommendation(q, q[1], [s({ ncm_id: 8 })], 'rewrite_tail');
  assert.deepEqual(r.queue.map(x => x.ncm_id), [2, 8]);
  assert.equal(r.now.ncm_id, 2);
});
test('applyChatRecommendation: insert_next → 插到 now 之后, now 不变', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 })];
  const r = applyChatRecommendation(q, q[0], [s({ ncm_id: 8 }), s({ ncm_id: 9 })], 'insert_next');
  assert.deepEqual(r.queue.map(x => x.ncm_id), [1, 8, 9, 2]);
  assert.equal(r.now.ncm_id, 1);
});
test('applyChatRecommendation: 不修改入参队列(纯函数)', () => {
  const q = [s({ ncm_id: 1 })];
  applyChatRecommendation(q, q[0], [s({ ncm_id: 2 })], 'insert_next');
  assert.equal(q.length, 1);
});

// decideQueueAction — 服务端确定性决定落队方式,不信模型自报的 queueAction(F4 防队列滚雪球)。
test('decideQueueAction: 默认换批 + 有 now → rewrite_tail(不打断当前歌、不滚雪球)', () => {
  assert.equal(decideQueueAction({ append: false, hasNow: true }), 'rewrite_tail');
});
test('decideQueueAction: 默认换批 + 无 now → replace_all', () => {
  assert.equal(decideQueueAction({ append: false, hasNow: false }), 'replace_all');
});
test('decideQueueAction: 显式追加 → insert_next(无论是否在播)', () => {
  assert.equal(decideQueueAction({ append: true, hasNow: true }), 'insert_next');
  assert.equal(decideQueueAction({ append: true, hasNow: false }), 'insert_next');
});
test('decideQueueAction: 缺省入参 → replace_all', () => {
  assert.equal(decideQueueAction(), 'replace_all');
});

test('arrangeQueue shuffles but keeps the pinned song first', () => {
  const q = [];
  for (let i = 0; i < 8; i++) q.push(s({ ncm_id: i, title: 'T' + i }));
  const out = arrangeQueue(q, { pinnedFirst: true, rng: () => 0 });
  assert.equal(out[0].ncm_id, 0, 'pinned (first) song stays at front');
  assert.equal(out.length, 8);
});
test('arrangeQueue without pinnedFirst shuffles all (pure, no input mutation)', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const out = arrangeQueue(q, { pinnedFirst: false, rng: () => 0 });
  assert.equal(out.length, 3);
  assert.equal(q.length, 3); // input untouched
});

test('arrangeQueue verbatim preserves playable order', () => {
  const q = [s({ ncm_id: 1 }), s({ ncm_id: 2 }), s({ ncm_id: 3 })];
  const out = arrangeQueue(q, { verbatim: true, rng: () => 0 });
  assert.deepEqual(out.map(x => x.ncm_id), [1, 2, 3]);
  assert.notEqual(out, q, 'still returns a new array');
});
