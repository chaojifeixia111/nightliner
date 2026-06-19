import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localStamp } from '../server/context-builder.js';

// 回归:prompt 注入的时间曾用 toISOString()(UTC,早 8h),把 GMT+8 的早上写成凌晨。
// localStamp 必须按 Asia/Shanghai 显式格式化,带 GMT+8 标注,且永不输出 UTC 的 Z 标记。

test('localStamp: 接近 UTC 午夜的瞬间 = GMT+8 的早上(不再是凌晨)', () => {
  // 00:30Z = 北京 08:30 周五 —— 旧代码会输出 "...T00:30:00Z" 让 LLM 读成凌晨
  const { ts, dow } = localStamp(new Date('2026-06-19T00:30:00Z'));
  assert.equal(ts, '2026-06-19 08:30 GMT+8');
  assert.equal(dow, '周五');
});

test('localStamp: 跨 UTC→GMT+8 日界,日期与星期同步前移', () => {
  // 18:00Z = 北京次日 02:00 周六
  const { ts, dow } = localStamp(new Date('2026-06-19T18:00:00Z'));
  assert.equal(ts, '2026-06-20 02:00 GMT+8');
  assert.equal(dow, '周六');
});

test('localStamp: 永不输出 UTC 的 Z 标记,始终带 GMT+8', () => {
  for (const iso of ['2026-01-01T00:00:00Z', '2026-06-19T09:00:00Z', '2026-12-31T16:00:00Z']) {
    const { ts } = localStamp(new Date(iso));
    assert.ok(ts.endsWith(' GMT+8'), `缺少 GMT+8 标注: ${ts}`);
    assert.ok(!/\dT\d|Z$/.test(ts), `泄漏了 UTC ISO 格式: ${ts}`);
  }
});
