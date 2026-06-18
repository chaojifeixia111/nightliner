const VALID_SOURCE_POOLS = new Set(['library', 'recommend', 'wildcard']);
const DEFAULT_SOURCE_POOL = 'wildcard';

function cleanString(v) {
  return typeof v === 'string' ? v.trim() : '';
}

export function normalizePlayItems(items) {
  const input = Array.isArray(items) ? items : [];
  const plays = [];
  let dropped = 0;

  for (const item of input) {
    const title = cleanString(item?.title);
    const artist = cleanString(item?.artist);
    const reason = cleanString(item?.reason);
    const rawSourcePool = cleanString(item?.source_pool);
    const source_pool = VALID_SOURCE_POOLS.has(rawSourcePool) ? rawSourcePool : DEFAULT_SOURCE_POOL;

    if (!title || !artist || !reason) {
      dropped++;
      continue;
    }

    plays.push({
      ...item,
      title,
      artist,
      reason,
      source_pool,
    });
  }

  return { plays, dropped };
}
