// server/indexer.js
// 全量/增量索引 (曲库 / 反馈 / chat / MD 文件) 到 embeddings + vec_embeddings.
import fs from 'fs/promises';
import { embed, embedBatch } from './embedder.js';
import { upsertEmbeddingRow, getEmbeddingsBySource, countEmbeddings } from './state-db.js';

const MAX_CHUNK = 400;
const OVERLAP = 50;

const PLAYLIST_TAG = {
  160249544: 'P',
  945616754: 'L',
};

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

export async function indexSong({ ncm_id, name, artist, tag }) {
  const source_id = `song:${ncm_id}`;
  // 跳过已索引
  if (getEmbeddingsBySource('song', source_id).length) return false;
  const chunk_text = `${name} / ${artist} [${tag}]`;
  const vec = await embed(chunk_text);
  upsertEmbeddingRow({
    source_type: 'song',
    source_id,
    chunk_text,
    meta: { ncm_id, name, artist, tag },
    embedding: vec,
  });
  return true;
}

export async function indexAllSongs() {
  let snapshot;
  try {
    snapshot = JSON.parse(await fs.readFile('data/netease-snapshot.json', 'utf8'));
  } catch {
    console.warn('[indexer] no netease-snapshot.json, skipping songs');
    return { added: 0, skipped: 0 };
  }

  const seen = new Set();
  const queue = [];
  for (const pl of Object.values(snapshot.playlists)) {
    const tag = PLAYLIST_TAG[pl.id] || '?';
    for (const s of pl.songs) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      queue.push({ ncm_id: s.id, name: s.name, artist: s.artists, tag });
    }
  }

  // Apple Music
  try {
    const md = await fs.readFile('user/apple-music-favorites-2024-2026.md', 'utf8');
    const pattern = /^\s*\d+\.\s+(.+?)\s+\/\s+(.+?)\s*$/gm;
    let m;
    let idx = 1_000_000;   // 避免和 ncm_id 冲突的虚拟 id
    while ((m = pattern.exec(md)) !== null) {
      queue.push({ ncm_id: `am:${idx++}`, name: m[1].trim(), artist: m[2].trim(), tag: 'M' });
    }
  } catch {}

  let added = 0;
  let skipped = 0;
  // 批量 embed 加速 (32 一批)
  const BATCH = 32;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    // 先过滤已索引
    const todo = batch.filter(s => !getEmbeddingsBySource('song', `song:${s.ncm_id}`).length);
    skipped += batch.length - todo.length;
    if (!todo.length) continue;
    const texts = todo.map(s => `${s.name} / ${s.artist} [${s.tag}]`);
    const vecs = await embedBatch(texts);
    for (let j = 0; j < todo.length; j++) {
      const s = todo[j];
      upsertEmbeddingRow({
        source_type: 'song',
        source_id: `song:${s.ncm_id}`,
        chunk_text: texts[j],
        meta: { ncm_id: s.ncm_id, name: s.name, artist: s.artist, tag: s.tag },
        embedding: vecs[j],
      });
      added++;
    }
    process.stdout.write(`\r[indexer] songs: ${added} added, ${skipped} skipped...   `);
  }
  process.stdout.write('\n');
  return { added, skipped };
}
