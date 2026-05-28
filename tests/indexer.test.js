// tests/indexer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdownByH2 } from '../server/indexer.js';

test('chunkMarkdownByH2 按 H2 切', () => {
  const md = `# Title

## 第一节
内容 A 第一段.
内容 A 第二段.

## 第二节
内容 B.

## 第三节
内容 C.`;
  const chunks = chunkMarkdownByH2(md);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].heading, '第一节');
  assert.ok(chunks[0].text.includes('内容 A 第一段'));
  assert.equal(chunks[2].heading, '第三节');
});

test('chunkMarkdownByH2 超长 H2 切到 ≤ 400 字符,带 50 字符 overlap', () => {
  const long = 'X'.repeat(900);
  const md = `## 长节\n${long}`;
  const chunks = chunkMarkdownByH2(md);
  assert.ok(chunks.length >= 2);
  for (const c of chunks) {
    assert.ok(c.text.length <= 400, `chunk too long: ${c.text.length}`);
  }
});

test('chunkMarkdownByH2 无 H2 时返回单 chunk', () => {
  const md = '只有正文,没标题';
  const chunks = chunkMarkdownByH2(md);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, '');
});
