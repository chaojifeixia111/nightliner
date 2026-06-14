// tests/llm-parse.test.js
// Layer-1 fix: the streaming chat path used to silently relabel a fenced-but-
// malformed JSON response as { intent: 'chat' }, dropping the model's actual
// recommend. ~10% of logged turns hit this; the dominant real cause is an
// unescaped " inside a reason string (see tests/fixtures/broken-json-01.txt,
// captured verbatim from data/llm-calls.jsonl 2026-06-12). These tests pin the
// recovery behavior against that real failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { splitSayAndJson, repairLooseJson } from '../server/llm-adapter.js';

const realBroken = fs.readFileSync(new URL('./fixtures/broken-json-01.txt', import.meta.url), 'utf8');

test('clean fenced JSON parses with status ok', () => {
  const text = 'opener words\n```json\n{"intent":"recommend","play":[{"title":"A","artist":"B"}]}\n```';
  const { say, parsed, status } = splitSayAndJson(text);
  assert.equal(status, 'ok');
  assert.equal(say, 'opener words');
  assert.equal(parsed.intent, 'recommend');
  assert.equal(parsed.play.length, 1);
});

test('real broken batch (unescaped quote) is recovered, not dropped to chat', () => {
  const text = '凌晨两点的每日推荐\n```json\n' + realBroken + '\n```';
  const { parsed, status } = splitSayAndJson(text);
  assert.equal(status, 'recovered');
  assert.equal(parsed.intent, 'recommend');
  assert.equal(parsed.queueAction, 'replace_all');
  assert.equal(parsed.play.length, 20, 'all 20 songs survive the repair');
  // the song whose reason carried the stray quote is preserved
  assert.ok(parsed.play.some(p => p.title === 'Shelter'));
});

test('repairLooseJson turns the real broken batch into parseable JSON', () => {
  const fixed = repairLooseJson(realBroken);
  const obj = JSON.parse(fixed);
  assert.equal(obj.play.length, 20);
});

test('repairLooseJson drops trailing commas', () => {
  const obj = JSON.parse(repairLooseJson('{"play":[{"a":1},],"x":2,}'));
  assert.equal(obj.play.length, 1);
  assert.equal(obj.x, 2);
});

test('prose-only (no fence) is legit chat, status ok', () => {
  const { say, parsed, status } = splitSayAndJson('就聊聊天，没有歌单。');
  assert.equal(status, 'ok');
  assert.equal(parsed.intent, 'chat');
  assert.equal(say, '就聊聊天，没有歌单。');
});

test('unrepairable fenced garbage reports status failed', () => {
  const text = 'hi\n```json\n{"play": ][ "nope" : : }\n```';
  const { status } = splitSayAndJson(text);
  assert.equal(status, 'failed');
});
