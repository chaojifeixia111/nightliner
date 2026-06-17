const VALID_SOURCE_POOLS = new Set(['library', 'recommend', 'wildcard']);

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
    const source_pool = cleanString(item?.source_pool);

    if (!title || !artist || !reason || !VALID_SOURCE_POOLS.has(source_pool)) {
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
