// tests/retriever.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveContext } from '../server/retriever.js';

test('retrieveContext 返回所有 budget 子集', async () => {
  const ctx = await retrieveContext({
    userMessage: '夜里听的歌',
    recentTurns: [],
    budgets: { song: 5, feedback: 2, life_stage: 1, taste: 1, mood_rule: 1 },
  });
  assert.ok(Array.isArray(ctx.songs));
  assert.ok(ctx.songs.length <= 5);
  assert.ok(Array.isArray(ctx.feedback));
  assert.ok(Array.isArray(ctx.life_stage_snippets));
  assert.ok(Array.isArray(ctx.taste_snippets));
  assert.ok(Array.isArray(ctx.mood_rule_snippets));
});

test('retrieveContext songs 包含 name/artist/tag/score', async () => {
  const ctx = await retrieveContext({
    userMessage: 'rock',
    recentTurns: [],
    budgets: { song: 3, feedback: 0, life_stage: 0, taste: 0, mood_rule: 0 },
  });
  if (ctx.songs.length) {
    const s = ctx.songs[0];
    assert.ok(typeof s.name === 'string');
    assert.ok(typeof s.artist === 'string');
    assert.ok(typeof s.tag === 'string');
    assert.ok(typeof s.score === 'number');
  }
});
