// tests/feedback-store.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import db, { recordFeedback } from '../server/state-db.js';

test('recordFeedback persists ncm_id', () => {
  db.exec("DELETE FROM feedback;");
  recordFeedback({ song_title: 'Run Free', song_artist: 'Deep Chills / IVIE', signal: 'love', ncm_id: 123456 });
  const row = db.prepare("SELECT ncm_id FROM feedback WHERE song_title='Run Free'").get();
  assert.equal(row.ncm_id, 123456);
});

test('feedback table has ncm_id column', () => {
  const cols = db.prepare("PRAGMA table_info(feedback)").all().map(c => c.name);
  assert.ok(cols.includes('ncm_id'), 'feedback.ncm_id column exists');
});
