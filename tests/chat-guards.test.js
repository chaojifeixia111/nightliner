import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayItems } from '../server/chat-guards.js';

test('normalizePlayItems keeps names-only items with title and artist', () => {
  const { plays, dropped } = normalizePlayItems([
    { title: 'Good', artist: 'Artist', reason: '来自每日推荐池', source_pool: 'recommend' },
    { title: 'No reason', artist: 'Artist', source_pool: 'recommend' },
    { title: 'Bad pool', artist: 'Artist', reason: '有理由', source_pool: 'daily' },
    { title: 'No pool', artist: 'Artist', reason: '有理由' },
    { title: '', artist: 'Artist', reason: '有理由', source_pool: 'library' },
  ]);

  assert.deepEqual(plays, [
    { title: 'Good', artist: 'Artist', reason: '来自每日推荐池', source_pool: 'recommend' },
    { title: 'No reason', artist: 'Artist', source_pool: 'recommend', reason: '' },
    { title: 'Bad pool', artist: 'Artist', reason: '有理由', source_pool: 'wildcard' },
    { title: 'No pool', artist: 'Artist', reason: '有理由', source_pool: 'wildcard' },
  ]);
  assert.equal(dropped, 1);
});

test('normalizePlayItems trims string fields and keeps optional metadata', () => {
  const { plays, dropped } = normalizePlayItems([
    {
      title: '  Good Time  ',
      artist: '  Owl City / Carly Rae Jepsen ',
      reason: ' 用户点名的第一首 ',
      source_pool: ' recommend ',
      confidence: 0.8,
      memoryLink: null,
      source_preference: 'netease',
    },
  ]);

  assert.equal(dropped, 0);
  assert.deepEqual(plays, [
    {
      title: 'Good Time',
      artist: 'Owl City / Carly Rae Jepsen',
      reason: '用户点名的第一首',
      source_pool: 'recommend',
      confidence: 0.8,
      memoryLink: null,
      source_preference: 'netease',
    },
  ]);
});
