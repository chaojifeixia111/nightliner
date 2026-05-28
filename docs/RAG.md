# NightlinerFM RAG 操作手册

> v0.5 — 2026-05-28 上线。BGE-M3 本地 ONNX 推理 + sqlite-vec 检索。

## 一句话

每次 chat：用户消息 → BGE-M3 embed → sqlite-vec 多路 top-K → 拼成 system+messages → DeepSeek 多轮。**prompt 从 45KB 砍到 ~12KB，无幻觉，强制探索比例。**

## 系统启动时发生了什么

1. `embedder.warmup()` 加载 BGE-M3 q8 ONNX (~3s 首次, 之后即时)
2. `indexAllSongs / indexAllFeedback / indexAllChatTurns / indexMdFile` 增量扫描
3. 已索引过的 source_id 自动跳过, 新数据自动加进 `embeddings` + `vec_embeddings`

启动日志样例：

```
[startup] warming up BGE-M3...
[startup] BGE-M3 ready
[startup] incremental index...
[startup] index done in 0.0s (songs +0, fb +0, turns +0)
```

## 每次 /api/chat 发生了什么

```
user msg → embed (~30ms)
        ↓
多路 retrieve (song top-30, fb top-8, life_stage top-3, taste top-3, mood top-2, vibe top-5, chat_turn top-3)
        ↓
buildChatMessages → {system: ~3KB, messages: [u, a, u, a, ..., u 当前轮]}
        ↓
DeepSeek API (multi-turn) → JSON 输出
        ↓
intent === 'recommend':
  enforceSourcePoolBudget(plays, target)
    ↓ 偏差 > 10%
  retry once with hint → 新 plays
        ↓
  checkReasonHallucination(plays, evidence)
    ↓ 命中 evidence 外细节
  mask reason
        ↓
  resolvePlayList (NCM) → broadcast queue
```

## 手动操作

| 操作 | 命令 |
|---|---|
| 全量重建 index | `rm data/state.db && npm run index:all` |
| 仅新增索引 | `npm run index:all` |
| 看 embedding 表统计 | `sqlite3 data/state.db "SELECT source_type, COUNT(*) FROM embeddings GROUP BY source_type"` |
| 单元测试 | `npm test` (⚠️ 会清空 embeddings, 跑完要 `npm run index:all`) |
| BGE-M3 sanity check | `npm run test:embed` |
| 端到端 smoke (KPOP→女声) | `node --env-file=.env scripts/smoke-rag.js` |
| 手测单次 chat | `curl -X POST localhost:8080/api/chat -H "Content-Type: application/json" -d '{"message":"推荐几首晚上的"}'` |

## 数据模型

```sql
-- 主嵌入索引表 (元数据 + 原文回显)
embeddings(id, source_type, source_id, chunk_text, meta_json, ts)
  UNIQUE(source_type, source_id)

-- sqlite-vec 虚表 (1024 维 Float32 向量)
vec_embeddings(embedding_id INTEGER PRIMARY KEY, embedding FLOAT[1024])
```

`source_type` 取值: `song` / `feedback` / `chat_turn` / `life_stage` / `taste` / `mood_rule` / `persona` / `vibe_anchor`

## Prompt 拆分

| 文件 | 用途 | 体积 |
|---|---|---|
| `prompts/system.md` | DJ 人格 + 约束 + 输出 schema (跨 session 不变,触发 DeepSeek prefix cache) | ~3KB |
| `prompts/user-turn.md` | 每轮变 (用户消息 + 当前 queue + RAG 检索结果) | ~8KB |
| `prompts/chat-mode.md` | 旧版单 prompt 模板 (cold-start.js / chat-once.js 仍用) | legacy |

## 调参

`config.yaml > rag.retrieval.*_top_k` — 召回数量, 越大 prompt 越长但召回越全
`config.yaml > rag.budget_enforcement.deviation_threshold` — 探索系数容忍, 默认 10%

## 性能预算 (实测)

| 阶段 | 延迟 |
|---|---|
| user msg embed | ~30ms |
| 多路 retrieve (7 类) | ~50ms |
| build messages | ~10ms |
| DeepSeek V4-flash (12KB prompt, 11 messages) | 8-30s |
| (条件) budget retry | +5-10s |
| NCM resolve + queue | ~2s |
| **端到端中位** | **~12-25s** |

启动开销：
- BGE-M3 首次加载: ~3s
- 全量索引 (~650 chunks): ~25s (CPU)
- 进程常驻内存: ~2.5GB (ONNX runtime)

## 灰度回退

`config.yaml > rag.enabled: false` 是预留字段，目前 `/api/chat` 没有读它。要紧急回退，`git revert <T15 commit SHA>`。

## 已知陷阱

1. **`npm test` 会清空 embeddings 表** — 测试文件 `DELETE FROM embeddings` 是有意为之（测试隔离），但目前用的是生产 db。跑测试后必须 `npm run index:all` 重新索引。**FOLLOWUP**: 把测试库改到 `:memory:` 或单独 path。
2. **sqlite-vec 的 vec0 虚表要求 INTEGER 主键** — better-sqlite3 默认绑 JS number 为 REAL，所有 `embedding_id` 必须 `BigInt(id)` 包一下。`upsertEmbeddingRow` 已处理。
3. **Hallucination checker 是启发式** — 会偶尔误伤包含 4 位年代或带书名号的合法 reason。代价是反应被遮蔽，不会影响歌曲选择。

## 文件清单

```
server/
  embedder.js           BGE-M3 inference (embed, embedBatch, warmup)
  vec-store.js          searchSimilar({embedding, source_type, top_k})
  indexer.js            chunkMarkdownByH2 + indexSong/indexFeedback/indexChatTurn/indexMdFile + indexAll*
  retriever.js          retrieveContext({userMessage, recentTurns, budgets})
  context-builder.js    buildChatMessages({...}) → {system, messages[]}
  llm-adapter.js        callLlm({system, messages, ...}) 多路 provider 分发
  budget-enforcer.js    enforceSourcePoolBudget + checkReasonHallucination
  state-db.js           +sqlite-vec load, +embeddings 表 + CRUD helpers
  index.js              /api/chat 用 buildChatMessages, 启动时 warmup+indexAll

prompts/
  system.md             DJ 人格 + 约束 (~3KB, prefix-cache 友好)
  user-turn.md          用户轮模板 (~8KB)

scripts/
  test-embed.js         BGE-M3 sanity (npm run test:embed)
  index-all.js          全量/增量索引 (npm run index:all)
  smoke-rag.js          两轮端到端 (KPOP→女声)

tests/
  embedder.test.js      embed / embedBatch
  state-db-vec.test.js  sqlite-vec wiring + upsert/get/delete
  vec-store.test.js     searchSimilar
  indexer.test.js       chunkMarkdownByH2
  retriever.test.js     retrieveContext shape
  budget-enforcer.test.js  budget + hallucination
```
