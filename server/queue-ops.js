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

// 把 chat 推荐返回的一批 playable 应用到 queue。返回 { queue, now, changed }。
// 护栏:playable 为空时**不动 queue**——避免「模型给了 recommend 但解析空/全无版权 →
// 整列被清空、now=null、播放中断」。queueAction:
//   rewrite_tail 保留 now、换掉其后;insert_next 插到 now 之后;其它(含缺省)= 整列替换。
export function applyChatRecommendation(queue, now, playable, queueAction) {
  if (!Array.isArray(playable) || playable.length === 0) {
    return { queue: [...queue], now, changed: false };
  }
  if (queueAction === 'rewrite_tail' && queue.length) {
    const idxNow = now ? queue.findIndex(x => sameSong(x, now)) : -1;
    const head = idxNow >= 0 ? [queue[idxNow]] : [];
    return { queue: [...head, ...playable], now: now || playable[0], changed: true };
  }
  if (queueAction === 'insert_next') {
    const idxNow = now ? queue.findIndex(x => sameSong(x, now)) : -1;
    const next = [...queue];
    next.splice(idxNow + 1, 0, ...playable);
    return { queue: next, now: now || playable[0], changed: true };
  }
  return { queue: [...playable], now: playable[0], changed: true };
}

// 给 chat 推荐队列排序:整体打散(避免「前面全是听过的」);pinnedFirst 时保住头部那首。
export function arrangeQueue(playable, { pinnedFirst = false, verbatim = false, rng = Math.random } = {}) {
  const arr = [...playable];
  if (verbatim) return arr;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  if (pinnedFirst && arr.length > 1) return [arr[0], ...shuffle(arr.slice(1))];
  return shuffle(arr);
}
