// tests/artist-resolver.test.js
// Artist alias resolution is an optional LLM fallback. Tests inject the call
// function so no network or real model is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeArtistAliasResolver } from '../server/artist-resolver.js';

test('makeArtistAliasResolver resolves common nickname to a verified canonical artist and caches it', async () => {
  let calls = 0;
  let seen;
  const resolver = makeArtistAliasResolver({
    model: 'fake-model',
    call: async (args) => {
      calls++;
      seen = args;
      return '{"artist":"Ariana Grande","confidence":0.94}';
    },
  });

  const artistNames = ['Ariana Grande', 'Taylor Swift'];
  assert.equal(await resolver('来一批A妹的歌', artistNames), 'Ariana Grande');
  assert.equal(await resolver('来一批A妹的歌', artistNames), 'Ariana Grande');
  assert.equal(calls, 1);
  assert.equal(seen.model, 'fake-model');
  assert.equal(seen.trigger, 'artist-alias');
  assert.equal(seen.jsonMode, true);
  assert.match(seen.messages.at(-1).content, /Ariana Grande/);
  assert.match(seen.messages.at(-1).content, /来一批A妹的歌/);
});

test('makeArtistAliasResolver rejects low-confidence aliases', async () => {
  const resolver = makeArtistAliasResolver({
    model: 'fake-model',
    call: async () => '{"artist":"Ariana Grande","confidence":0.49}',
  });
  assert.equal(await resolver('来一批A妹的歌', ['Ariana Grande']), null);
});

test('makeArtistAliasResolver rejects artists outside the allowed library list', async () => {
  const resolver = makeArtistAliasResolver({
    model: 'fake-model',
    call: async () => '{"artist":"Ariana Grande","confidence":0.97}',
  });
  assert.equal(await resolver('来一批A妹的歌', ['Taylor Swift']), null);
});

test('makeArtistAliasResolver returns null on malformed model output', async () => {
  const resolver = makeArtistAliasResolver({
    model: 'fake-model',
    call: async () => 'not json',
  });
  assert.equal(await resolver('来一批A妹的歌', ['Ariana Grande']), null);
});
