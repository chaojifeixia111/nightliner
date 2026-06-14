// tests/db-isolation.test.js
// Regression guard against a real incident: the unit tests import
// server/state-db.js and run `DELETE FROM embeddings; DELETE FROM vec_embeddings;`.
// state-db.js used to hardcode the production path 'data/state.db', so every
// `npm test` wiped the live RAG index. This test fails if isolation regresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbPath } from '../server/state-db.js';

test('the test runner never opens the production DB', () => {
  assert.notEqual(
    dbPath, 'data/state.db',
    'state-db.js opened the production DB under the test runner — tests would corrupt prod data',
  );
  assert.equal(dbPath, ':memory:');
});
