// tests/budget-enforcer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceSourcePoolBudget, checkReasonHallucination } from '../server/budget-enforcer.js';

test('完全命中 budget → ok', () => {
  const plays = [
    { source_pool: 'library' }, { source_pool: 'library' }, { source_pool: 'library' },
    { source_pool: 'library' }, { source_pool: 'library' }, { source_pool: 'library' }, { source_pool: 'library' },
    { source_pool: 'recommend' }, { source_pool: 'recommend' }, { source_pool: 'wildcard' },
  ];   // 7/2/1 = 70/20/10
  const r = enforceSourcePoolBudget(plays, { lib: 70, rec: 20, wild: 10 });
  assert.equal(r.ok, true);
});

test('偏差 >10% → not ok, 含 hint', () => {
  const plays = Array(10).fill({ source_pool: 'library' });   // 100/0/0
  const r = enforceSourcePoolBudget(plays, { lib: 70, rec: 20, wild: 10 });
  assert.equal(r.ok, false);
  assert.ok(r.hint.includes('70'));
  assert.ok(r.hint.includes('20'));
});

test('reason 含 evidence 外细节 → 被标记', () => {
  const plays = [{ title: 'X', artist: 'Y', reason: '出自 2019 年的专辑 Blonde, 跟 SZA 合作' }];
  const evidence = '相关曲库:\n1. Other / Other [L]';
  const hits = checkReasonHallucination(plays, evidence);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].suspect_terms.includes('2019') || hits[0].suspect_terms.some(t => t.includes('Blonde')));
});

test('reason 全锚 evidence → 不标记', () => {
  const plays = [{ title: 'X', artist: 'Y', reason: '上周你播过 3 次' }];
  const hits = checkReasonHallucination(plays, 'irrelevant evidence');
  assert.equal(hits.length, 0);
});
