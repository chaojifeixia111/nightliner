import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRgb } from '../pwa/src/utils/ambient.js';

test('averageRgb: 单像素返回该像素', () => {
  assert.deepEqual(averageRgb(new Uint8ClampedArray([10, 20, 30, 255])), { r: 10, g: 20, b: 30 });
});

test('averageRgb: 红蓝各半取均值', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  assert.deepEqual(averageRgb(data), { r: 128, g: 0, b: 128 });
});

test('averageRgb: 空数据回退 null', () => {
  assert.equal(averageRgb(new Uint8ClampedArray([])), null);
});
