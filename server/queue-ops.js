// server/queue-ops.js
// currentQueue / now 的纯变更逻辑。返回新数组,不改入参。song 是已解析的 playable。

export function sameSong(a, b) {
  if (!a || !b) return false;
  if (a.ncm_id != null && b.ncm_id != null) return a.ncm_id === b.ncm_id;
  return a.title === b.title && a.artist === b.artist;
}

// 立即播放:把 song 插到当前 now 之后并设为 now。now 不在队列(或为 null)时插到队首。
export function playNow(queue, now, song) {
  const idx = now ? queue.findIndex(x => sameSong(x, now)) : -1;
  const next = [...queue];
  next.splice(idx + 1, 0, song);   // idx=-1 → splice(0,0,...) 插到队首
  return { queue: next, now: song };
}

// 加入队列末尾。若当前没有 now,则这首立即成为 now。
export function enqueue(queue, now, song) {
  return { queue: [...queue, song], now: now || song };
}

// 清空待播队列:正在播的歌保留为唯一一项,播完自然走"queue 结束"。
export function clearUpcoming(queue, now) {
  return { queue: now ? [now] : [], now: now || null };
}

// 从待播队列移除指定歌。正在播的歌不可移除(保护 now)。
export function removeFromQueue(queue, now, song) {
  if (now && sameSong(song, now)) return { queue: [...queue], now };
  return { queue: queue.filter(x => !sameSong(x, song)), now };
}
