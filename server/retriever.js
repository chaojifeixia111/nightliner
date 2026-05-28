// server/retriever.js
// 多路 RAG 检索: 给定 user message,从 embeddings 表按 source_type 拉 top-K.
import { embed } from './embedder.js';
import { searchSimilar } from './vec-store.js';

const DEFAULT_BUDGETS = {
  song: 30,
  feedback: 8,
  life_stage: 3,
  taste: 3,
  mood_rule: 2,
  persona: 1,
  vibe_anchor: 5,
  chat_turn: 3,
};

export async function retrieveContext({ userMessage, recentTurns = [], budgets = {} }) {
  const B = { ...DEFAULT_BUDGETS, ...budgets };
  const queryVec = await embed(userMessage);

  const songRows = B.song ? searchSimilar({ embedding: queryVec, source_type: 'song', top_k: B.song }) : [];
  const fbRows = B.feedback ? searchSimilar({ embedding: queryVec, source_type: 'feedback', top_k: B.feedback }) : [];
  const lsRows = B.life_stage ? searchSimilar({ embedding: queryVec, source_type: 'life_stage', top_k: B.life_stage }) : [];
  const tasteRows = B.taste ? searchSimilar({ embedding: queryVec, source_type: 'taste', top_k: B.taste }) : [];
  const moodRows = B.mood_rule ? searchSimilar({ embedding: queryVec, source_type: 'mood_rule', top_k: B.mood_rule }) : [];
  const vibeRows = B.vibe_anchor ? searchSimilar({ embedding: queryVec, source_type: 'vibe_anchor', top_k: B.vibe_anchor }) : [];
  const turnRows = B.chat_turn ? searchSimilar({ embedding: queryVec, source_type: 'chat_turn', top_k: B.chat_turn }) : [];

  return {
    songs: songRows.map(r => ({
      name: r.meta.name || '',
      artist: r.meta.artist || '',
      tag: r.meta.tag || '',
      ncm_id: r.meta.ncm_id,
      score: Math.max(0, 1 - r.distance),   // clamp negative scores to 0; sqlite-vec 默认 L2 距离
    })),
    feedback: fbRows.map(r => ({
      title: r.meta.target_title,
      artist: r.meta.target_artist,
      signal: r.meta.signal,
      reason: r.meta.reason,
      ts: r.meta.ts,
    })),
    life_stage_snippets: lsRows.map(r => r.chunk_text),
    taste_snippets: tasteRows.map(r => r.chunk_text),
    mood_rule_snippets: moodRows.map(r => r.chunk_text),
    vibe_anchor_snippets: vibeRows.map(r => r.chunk_text),
    semantic_history: turnRows.map(r => r.chunk_text),
    recent_history: recentTurns,    // 近因优先,调用方传入
  };
}
