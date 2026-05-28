// server/indexer.js
// 全量/增量索引 (曲库 / 反馈 / chat / MD 文件) 到 embeddings + vec_embeddings.

const MAX_CHUNK = 400;
const OVERLAP = 50;

export function chunkMarkdownByH2(md) {
  const lines = md.split('\n');
  const sections = [];
  let curHeading = '';
  let curBody = [];
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (curBody.length || curHeading) sections.push({ heading: curHeading, body: curBody.join('\n').trim() });
      curHeading = h2[1].trim();
      curBody = [];
    } else if (!line.match(/^#\s/)) {
      curBody.push(line);
    }
  }
  if (curBody.length || curHeading) sections.push({ heading: curHeading, body: curBody.join('\n').trim() });

  // 若整篇没切到 H2 (sections 为空 或 都是 heading='')
  if (sections.length === 0 || sections.every(s => !s.heading && !s.body)) {
    const fallback = md.trim();
    if (!fallback) return [];
    return splitLong({ heading: '', text: fallback });
  }

  const out = [];
  for (const s of sections) {
    if (!s.body && !s.heading) continue;
    out.push(...splitLong({ heading: s.heading, text: s.body }));
  }
  return out;
}

function splitLong({ heading, text }) {
  if (text.length <= MAX_CHUNK) return [{ heading, text }];
  const out = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + MAX_CHUNK, text.length);
    out.push({ heading, text: text.slice(i, end) });
    if (end === text.length) break;
    i = end - OVERLAP;
  }
  return out;
}
