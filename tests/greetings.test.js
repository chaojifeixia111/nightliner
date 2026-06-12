import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickGreeting } from '../pwa/src/utils/greetings.js';

const HOURS = [7, 13, 19, 23, 3];

test('pickGreeting: 各时段都返回非空纯 ASCII 英文', () => {
  for (const h of HOURS) {
    for (let i = 0; i < 20; i++) {
      const g = pickGreeting(new Date(2026, 5, 12, h));
      assert.ok(g.length > 0);
      assert.match(g, /^[\x20-\x7E]+$/, `non-ASCII greeting at hour ${h}: ${g}`);
    }
  }
});

test('pickGreeting: 不再出现破折号抒情体', () => {
  for (const h of HOURS) {
    for (let i = 0; i < 20; i++) {
      assert.ok(!pickGreeting(new Date(2026, 5, 12, h)).includes('—'));
    }
  }
});
