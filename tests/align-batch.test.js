// tests/align-batch.test.js
// Layer 3: meta.verbatim 让 repairFamiliarNew 跳过「熟悉↔全新」比例换槽,
// 保住模型的选曲与顺序 —— 用于 "直接放每日推荐" / "第一首放 X" 这类显式指令。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairFamiliarNew } from '../server/align-batch.js';
import { songKey } from '../server/explore-pool.js';

const lib = [{ name: 'LibA', artist: 'x' }, { name: 'LibB', artist: 'y' }];
function meta(over) {
  return {
    famTarget: 2,
    libKeys: new Set(lib.map(s => songKey(s.name, s.artist))),
    librarySlice: lib,
    explorePool: [],
    recommendPool: [],
    direction: null,
    ...over,
  };
}
const freshPlays = () => ([
  { title: 'New1', artist: 'a', source_pool: 'recommend' },
  { title: 'New2', artist: 'b', source_pool: 'recommend' },
  { title: 'New3', artist: 'c', source_pool: 'recommend' },
]);

test('no-direction: ratio realign swaps new songs toward famTarget (control)', () => {
  const plays = freshPlays();
  const r = repairFamiliarNew(plays, meta());
  assert.ok(r.repaired >= 1, 'should swap at least one slot to hit famTarget');
  assert.ok(plays.some(p => p.title === 'LibA' || p.title === 'LibB'), 'library songs swapped in');
});

test('verbatim: ratio realign is skipped — model picks & order preserved', () => {
  const plays = freshPlays();
  const before = plays.map(p => p.title);
  const r = repairFamiliarNew(plays, meta({ verbatim: true }));
  assert.equal(r.repaired, 0);
  assert.deepEqual(plays.map(p => p.title), before);
});

test('direction turn now aligns familiar/new ratio (swaps to in-direction new)', () => {
  const dir = { langMatch: 'chinese', gender: null, artists: [], raw: '国语' };
  const plays = [
    { title: '库A', artist: '甲', source_pool: 'library' },
    { title: '库B', artist: '乙', source_pool: 'library' },
    { title: '库C', artist: '丙', source_pool: 'library' },
  ];
  const meta = {
    famTarget: 1, direction: dir,
    libKeys: new Set([songKey('库A', '甲'), songKey('库B', '乙'), songKey('库C', '丙')]),
    librarySlice: [], recommendPool: [],
    explorePool: [{ name: '新中文', artist: '丁', ncm_id: 9 }], // Han title → chinese, in-direction NEW
  };
  const r = repairFamiliarNew(plays, meta);
  assert.ok(r.repaired >= 1, 'ratio ran under direction');
  assert.ok(plays.some(p => p.title === '新中文'), 'pulled an in-direction new song');
});

test('pinnedFirst keeps play[0] while aligning the rest', () => {
  const plays = [
    { title: 'PINNED', artist: 'p', source_pool: 'wildcard' },   // index 0, not in lib
    { title: '库A', artist: '甲', source_pool: 'library' },
    { title: '库B', artist: '乙', source_pool: 'library' },
  ];
  const meta = {
    famTarget: 0, direction: null, pinnedFirst: true,
    libKeys: new Set([songKey('库A', '甲'), songKey('库B', '乙')]),
    librarySlice: [], recommendPool: [],
    explorePool: [{ name: 'NEW1', artist: 'n', ncm_id: 1 }, { name: 'NEW2', artist: 'm', ncm_id: 2 }],
  };
  repairFamiliarNew(plays, meta);
  assert.equal(plays[0].title, 'PINNED', 'pinned head untouched');
  assert.ok(plays.slice(1).some(p => p.title.startsWith('NEW')), 'the rest still got aligned to new');
});

test('pinnedFirst protects play[0] even when it is a library song', () => {
  const plays = [
    { title: '库A', artist: '甲', source_pool: 'library' }, // pinned, in lib
    { title: '库B', artist: '乙', source_pool: 'library' },
    { title: '库C', artist: '丙', source_pool: 'library' },
  ];
  const meta = {
    famTarget: 0, direction: null, pinnedFirst: true,
    libKeys: new Set([songKey('库A', '甲'), songKey('库B', '乙'), songKey('库C', '丙')]),
    librarySlice: [], recommendPool: [],
    explorePool: [{ name: 'NEW1', artist: 'n', ncm_id: 1 }, { name: 'NEW2', artist: 'm', ncm_id: 2 }],
  };
  repairFamiliarNew(plays, meta);
  assert.equal(plays[0].title, '库A', 'library pinned head is NOT swapped out');
});
