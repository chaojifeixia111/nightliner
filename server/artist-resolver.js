// server/artist-resolver.js
// Optional LLM fallback for common artist nicknames ("A妹", "霉霉", "断眉"...).
// It never creates a hard direction by itself: the returned name must verify
// against the local artist list before direction.js accepts it.
import { callLlm, extractJson } from './llm-adapter.js';
import { norm } from './direction.js';

function canonicalArtist(candidate, artistNames = []) {
  const wanted = norm(candidate || '');
  if (!wanted) return null;
  return artistNames.find(a => norm(a) === wanted) || null;
}

function cacheKey(message, artistNames) {
  return `${norm(message)}|${artistNames.map(a => norm(a)).sort().join(',')}`;
}

export function makeArtistAliasResolver({ model, call = callLlm, minConfidence = 0.7 } = {}) {
  const cache = new Map();

  return async function resolveArtistAlias(message, artistNames = []) {
    if (!model || !message || !artistNames.length) return null;
    const key = cacheKey(message, artistNames);
    if (cache.has(key)) return cache.get(key);

    const allowed = artistNames.map(a => `- ${a}`).join('\n');
    const system = [
      'You normalize artist nicknames in a music request.',
      'Return only JSON: {"artist": string|null, "confidence": number}.',
      'Only choose an artist from the provided allowed list.',
      'If the request does not clearly mention a specific artist, return {"artist":null,"confidence":0}.',
    ].join('\n');
    const messages = [{
      role: 'user',
      content: [
        'Allowed canonical artists:',
        allowed,
        '',
        `User request: ${message}`,
      ].join('\n'),
    }];

    try {
      const raw = await call({ system, messages, model, trigger: 'artist-alias', jsonMode: true });
      const parsed = extractJson(raw);
      const confidence = Number(parsed?.confidence || 0);
      const artist = canonicalArtist(parsed?.artist, artistNames);
      const result = artist && confidence >= minConfidence ? artist : null;
      cache.set(key, result);
      return result;
    } catch {
      cache.set(key, null);
      return null;
    }
  };
}
