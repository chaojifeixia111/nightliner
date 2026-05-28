# NightlinerFM RAG + 本地 Embedding 设计文档

**日期**: 2026-05-28
**作者**: Elliot + Claude
**状态**: Draft, 待 review
**关联**: 2026-05-08-nightliner-windows-mvp-design.md

---

## 1. 背景与动机

NightlinerFM v0.4 上线后暴露 4 个核心问题:

1. **响应慢** — 每次 chat 给 DeepSeek 发约 45KB prompt, 端到端 20-30s
2. **上下文薄** — 推歌总落在曲库里"最安全"的几首, 不出新意
3. **幻觉** — 描述与歌曲对不上 (虚构专辑年代, 错搭合作艺人)
4. **探索系数失效** — prompt 写 70/20/10, 但 server 无校验, 模型按"哪首最确定"挑

根因诊断:
- prompt 太长 → attention 稀释 → 上下文+召回质量双降
- prompt 全量塞库 → 模型只能凭世界知识补全细节 → 幻觉
- 单消息格式 (非 messages[] 多轮) → 第二轮看不到第一轮方向
- 无 source_pool budget 校验 → 探索约束只是建议而非强制

本设计用 **RAG (Retrieval-Augmented Generation)** + **本地 Embedding (BGE-M3)** + **多轮 messages 格式** + **server 端 budget 校验** 一次性解决.

## 2. 设计目标

| 目标 | 指标 |
|---|---|
| Prompt 体积 | 45KB → ≤ 12KB |
| Chat 端到端延迟 | 20-30s → 5-10s |
| 推歌新鲜度 | 同一 session 第二轮去重率 ≥ 70% |
| 反幻觉 | reason 必须引用 evidence 字段, 出现 evidence 外细节即拒收 |
| 探索系数实际生效 | 实测 source_pool 分布与 prompt 声明偏差 ≤ 10% |
| 隐私边界 | 不外泄数据, embedding 模型本地推理 (BGE-M3 q8 ONNX) |

非目标 (本期不做):
- 反馈周度收敛 (M8, 后续 phase)
- 跨设备 sync
- 流式响应 (DeepSeek 支持但不在本期)

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                       PWA  (Vue 3)                           │
└──────────────────────┬──────────────────────────────────────┘
                       │  POST /api/chat { message }
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Server (server/index.js)                                    │
│                                                              │
│  1. 取 user message                                         │
│  2. ┌─→ embedder.embed(message)        ← BGE-M3 本地推理    │
│     │                                                        │
│  3. │   retriever.search(vec):                              │
│     │   ├─ top-30 songs   from vec_embeddings(source=song)  │
│     │   ├─ top-8 feedback from vec_embeddings(source=fb)    │
│     │   ├─ top-3 chunks   from vec_embeddings(source=stage) │
│     │   └─ top-3 chunks   from vec_embeddings(source=taste) │
│     │                                                        │
│  4. │   buildChatMessages():                                │
│     │   ├─ system: 人格+约束+输出 schema (~2KB, 不变)       │
│     │   ├─ user/assistant 多轮 (从 chat_turns 取最近 N)     │
│     │   └─ user 本轮 + RAG context (~8KB)                   │
│     │                                                        │
│  5. └→ DeepSeek API (messages[] 多轮)                       │
│                                                              │
│  6. parse JSON → enforceSourcePoolBudget()                  │
│        ├─ 实际分布偏离声明 > 10%? → retry with hint         │
│        └─ reason 出现 evidence 外细节? → 标记 + 降权        │
│                                                              │
│  7. resolvePlayList (NCM) → queue → broadcast               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  data/state.db  (SQLite + sqlite-vec extension)              │
│                                                              │
│  原有表: play_events / feedback / anti_list / cooldown /    │
│         queues / chat_turns                                  │
│                                                              │
│  新增表:                                                     │
│    embeddings(id, source_type, source_id, chunk_text,       │
│               meta_json, ts)                                 │
│    vec_embeddings(embedding_id, embedding FLOAT[1024])      │
│         ← sqlite-vec 虚拟表, 主表 join                       │
└─────────────────────────────────────────────────────────────┘
```

## 4. 数据模型

### 新增表

```sql
-- 主嵌入索引表 (元数据 + 原文回显用)
CREATE TABLE embeddings (
  id          INTEGER PRIMARY KEY,
  source_type TEXT NOT NULL,    -- 'song'|'feedback'|'chat_turn'|'life_stage'|'mood_rule'|'taste'|'vibe_anchor'
  source_id   TEXT NOT NULL,    -- 关联原表/文件位置 ('song:12345', 'fb:42', 'life_stage:long-shot:chunk-3')
  chunk_text  TEXT NOT NULL,    -- 被向量化的原文 (回显进 prompt 用)
  meta_json   TEXT,             -- {artist, tag, ts, genre, ...}
  ts          INTEGER NOT NULL  -- 写入时间
);

CREATE INDEX idx_embeddings_source ON embeddings(source_type, source_id);

-- sqlite-vec 虚拟表 (1024 维 float32 向量)
CREATE VIRTUAL TABLE vec_embeddings USING vec0(
  embedding_id INTEGER PRIMARY KEY,
  embedding FLOAT[1024]
);
```

### 各 source_type 的 chunk 策略

| source_type | chunk 粒度 | meta_json 内容 |
|---|---|---|
| `song` | 每首 1 chunk: `<name> / <artist> [<章节>] (<plays>)` | `{artist, tag, ncm_id, recent_play_count}` |
| `feedback` | 每条 1 chunk: `<title> / <artist> -- [<signal>] <reason>` | `{signal, ts, target_title, target_artist}` |
| `chat_turn` | 每轮 1 chunk: `[用户] <msg> [DJ <intent>] <say> 推:<titles>` | `{intent, ts, queue_action}` |
| `life_stage` | 按 H2 标题切, 每片 200-400 字符 | `{stage_name, era, source: 'life-stages.md'}` |
| `mood_rule` | 每条规则 1 chunk | `{rule_id, source: 'mood-rules.md'}` |
| `taste` | 按 H2 切, 200-400 字符 | `{section, source: 'taste.md'}` |
| `vibe_anchor` | 每个 vibe 1 chunk (可选, 用户后期写) | `{vibe_name, source: 'vibe-anchors.md'}` |

## 5. 模块拆分

按 brainstorming 原则: 每个模块单一职责, 通过明确接口通信, 可独立测试.

### 5.1 `server/embedder.js` — 本地 BGE-M3 推理

```javascript
// 接口:
import { embed, embedBatch } from './embedder.js';

await embed("夜里听的歌");           // → Float32Array(1024)
await embedBatch(["a","b","c"]);    // → Float32Array[](batched)
```

实现:
- 单例 pipeline (启动时 lazy load, 全进程共享)
- 用 `@huggingface/transformers` 加载 `Xenova/bge-m3` q8 ONNX
- `env.cacheDir = process.env.HF_CACHE_DIR` (D 盘)
- `env.remoteHost = process.env.HF_ENDPOINT` (hf-mirror.com)
- pooling: 'cls', normalize: true (cosine 等价 dot product)

不依赖: 任何 LLM 调用

### 5.2 `server/vec-store.js` — sqlite-vec 封装

```javascript
// 接口:
import { upsertEmbedding, searchSimilar, deleteBySource } from './vec-store.js';

upsertEmbedding({ source_type, source_id, chunk_text, meta, embedding });
searchSimilar({ embedding, source_type, top_k, filter });   // → [{score, chunk_text, meta}]
deleteBySource(source_type, source_id);
```

实现:
- 在现有 `state-db.js` import 后加载 sqlite-vec 扩展
- 提供主表 + vec 表的事务性插入
- search: vec_embeddings cosine 距离 + 主表 JOIN 回显

不依赖: embedder (调用方先 embed 再传入)

### 5.3 `server/indexer.js` — 全量索引 + 增量索引

```javascript
// 接口:
import { indexAll, indexSong, indexFeedback, indexChatTurn, indexMdFile } from './indexer.js';

await indexAll();           // 启动时调,跳过已有
await indexSong({ name, artist, tag, ncm_id });
await indexFeedback(fbRow);
await indexChatTurn(turnRow);
await indexMdFile('user/life-stages.md', 'life_stage');
```

实现:
- `indexAll`: 跑 4 件事 (曲库 / 反馈 / chat_turns / MD 文件)
- 幂等: 通过 `(source_type, source_id)` 去重
- MD chunk: 按 H2 切, 每 chunk ≤ 400 chars, overlap 50 chars
- 文件 mtime 变更触发重新 index

依赖: embedder, vec-store

### 5.4 `server/retriever.js` — RAG 检索拼装

```javascript
// 接口:
import { retrieveContext } from './retriever.js';

const ctx = await retrieveContext({
  userMessage,
  recentTurns,    // 最近 2 轮强制带 (近因)
  budgets: { song: 30, feedback: 8, life_stage: 3, taste: 3, mood_rule: 2 },
});
// → {
//     songs: [{name, artist, tag, score}, ...],
//     feedback: [...],
//     life_stage_snippets: [...],
//     taste_snippets: [...],
//     mood_rule_snippets: [...],
//   }
```

实现:
- 单次 embed(userMessage) 后多路 search
- 强制带最近 2 轮 chat_turns (即使语义不相关,近因优先)
- ANTI_LIST 全量保留 (不走 RAG, 因为是 hard constraint)
- COOLDOWNS 全量保留 (同上)

依赖: embedder, vec-store, state-db

### 5.5 `server/context-builder.js` — **重构** 为 messages 多轮格式

```javascript
// 旧接口:
buildChatPrompt({ userMessage, ... }) → string

// 新接口:
buildChatMessages({ userMessage, currentQueue, n, exploration_pct, recommendPool, retrievedCtx }) → {
  system: string,
  messages: [
    { role: 'user', content: '...' },
    { role: 'assistant', content: '...JSON...' },
    ...
    { role: 'user', content: '本轮 user msg + 当前 queue + RAG context' },
  ],
}
```

- system: DJ 人格 + 约束 + 输出 schema (~2KB, 跨 session 几乎不变, 触发 DeepSeek prefix cache)
- messages: 从 chat_turns 取最近 5 轮 user/assistant 交替 (每轮 assistant 是完整 JSON, 用于回放)
- 当前 user turn 末尾追加: 当前 queue + RAG 检索结果

`chat-mode.md` 拆成两份: `prompts/system.md` + `prompts/user-turn.md`

### 5.6 `server/llm-adapter.js` — 支持 messages[] 入参

```javascript
// 扩展接口:
callLlm({ system, messages, model, trigger }) → assistantContent
```

- 把现有 single-prompt 路径保留 (旧 path 还在用)
- 新增 messages path: body.messages = [{role:'system',...}, ...messages]
- jsonMode 不强制 (DeepSeek 在 system 里就要求 JSON 输出)

### 5.7 `server/budget-enforcer.js` — 探索系数强制 + 反幻觉

```javascript
// 接口:
import { enforceSourcePoolBudget, checkReasonHallucination } from './budget-enforcer.js';

enforceSourcePoolBudget(play, declaredBudget);
  // → { ok, deviation, hint }    // hint 给 retry 用

checkReasonHallucination(play, evidence);
  // → [{ play_idx, suspect_terms }]
```

实现:
- budget: 统计 source_pool 分布 vs 声明分布 (绝对差 ≤ 10% 即 ok)
- 不 ok → server 调用 LLM 第二次, system 加 "上一次比例不对, 必须 X% library / Y% recommend / Z% wildcard"
- reason 反幻觉: 提取 reason 里的专有名词 (年代 4 位数 / 专辑名候选 / 艺人名候选), 不在 evidence 出现 → 标记
- 标记后: reason 字段被替换为 "(reason 含未验证细节, 已隐藏)" 或换歌

### 5.8 `server/index.js` — 改 `/api/chat` 调用链

```javascript
// 旧:
const prompt = await buildChatPrompt({...});
const raw = await callLlm({ prompt, model });

// 新:
const userVec = await embed(userMessage);
const retrievedCtx = await retrieveContext({ userMessage, recentTurns, budgets });
const { system, messages } = await buildChatMessages({...retrievedCtx});
const raw = await callLlm({ system, messages, model });
const parsed = extractJson(raw);

// 新增 budget 强制
const { ok, hint } = enforceSourcePoolBudget(parsed.play, ...);
if (!ok) {
  // 二次调用,带 hint
  const raw2 = await callLlm({ system, messages: [...messages, retryHint(hint)], model });
  parsed = extractJson(raw2);
}
```

## 6. Prompt 重组

### 6.1 system.md (~2KB, 几乎不变,触发 prefix cache)

```
你是 NightlinerFM 的 DJ. 每次接到 user 消息,先判断 intent (recommend/chat/feedback),
再按对应 schema 输出 JSON.

## 输出 schema
{ ... }

## 推歌强约束
1. reason 必须锚定 evidence,禁止泛音乐描述
2. reason 出现的专辑年代/合作艺人/歌词,必须在本次 prompt 的 RAG context 出现过
3. 不能重复 RECENT_PLAYS 列表里任何一首
4. source_pool 比例必须严格命中 (server 会校验)
5. 细化语言 (换一批/再来/换批) = 继承上轮方向 + 叠加新约束,不替换

## 隐私边界
引用 life-stages 用时段化("那段日子常听的"),不复述事件名词.
```

### 6.2 user-turn.md (~8KB, 每轮变)

```
{{USER_MESSAGE}}

## 当前 queue
{{CURRENT_QUEUE}}

## 当前 now-playing
{{NOW_PLAYING}}

## 探索系数: {{EXPLORATION_PCT}}%
目标分布: library {{LIB_PCT}}% / recommend {{REC_PCT}}% / wildcard {{WILD_PCT}}%

## RAG 检索结果

### 相关曲库 (top-30, evidence 之一)
{{LIBRARY_SLICE}}

### 相关历史反馈 (top-8, evidence 之二)
{{FEEDBACK_SLICE}}

### 相关生活阶段片段 (top-3)
{{LIFE_STAGE_SLICE}}

### 相关 taste 片段 (top-3)
{{TASTE_SLICE}}

### Anti-list (永久禁播, 全量)
{{ANTI_LIST}}

### Cooldown (90 天降权, 全量)
{{COOLDOWNS}}

### 网易云推荐池 (用于 recommend 通道)
{{RECOMMEND_POOL}}
```

## 7. 索引时机

| 时机 | 操作 | 频率 |
|---|---|---|
| 启动 | `indexAll()` (跳过已索引) | 每次 server 启动 |
| `recordFeedback` 后 | 顺手 `indexFeedback(row)` | 每条反馈 |
| `recordChatTurn` 后 | 顺手 `indexChatTurn(row)` | 每轮对话 |
| MD 文件 mtime 变 | 重新 chunk + 替换 | 启动检测 + watch (后续) |
| 曲库 snapshot 重抓 | `indexAll()` 部分跑 song | 手动触发 |

## 8. 配置变更

### `.env` 新增
```bash
HF_CACHE_DIR=D:/Elliot/新建文件夹/.cache/huggingface
HF_ENDPOINT=https://hf-mirror.com
```

### `config.yaml` 新增 (建议)
```yaml
rag:
  enabled: true
  retrieval:
    song_top_k: 30
    feedback_top_k: 8
    life_stage_top_k: 3
    taste_top_k: 3
    mood_rule_top_k: 2
  embedding:
    model: 'Xenova/bge-m3'
    dim: 1024
    quantization: 'q8'
  budget_enforcement:
    enabled: true
    deviation_threshold: 0.10   # 10%
    max_retries: 1
```

## 9. 性能预算

| 链路阶段 | 当前 | 目标 |
|---|---|---|
| user msg embed | — | ~100ms |
| 多路 retrieve (4 类) | — | ~50ms |
| build messages | ~10ms | ~10ms |
| DeepSeek 推理 (prompt 砍到 10KB) | 20-30s | 4-8s |
| budget 校验 + (条件)重试 | — | 0-5s |
| NCM resolve + queue | ~2s | ~2s |
| **端到端中位** | **~25s** | **~7s** |

启动开销:
- BGE-M3 首次加载: ~3s
- 全量索引曲库 579 首: 估算 1-3 分钟 (CPU)
- 进程常驻内存: ~2.5GB (主要是 ONNX runtime)

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| BGE-M3 q8 量化精度损失 | 召回质量降 | 关键链路 (反馈 retrieve) 验证, 必要时升 fp16 |
| sqlite-vec Windows 兼容 | 装不上 | 已预装验证, 不行换 lancedb |
| HF 镜像不稳定 | 下载失败 | 备用: hf-mirror / modelscope / 离线包 |
| 内存 2.5GB 过大 | 影响其他进程 | 提供 `RAG_ENABLED=false` 开关回退 |
| 反馈很少时 RAG 召回稀疏 | 第一周效果不明显 | 用户写 vibe-anchors.md 加速冷启动 |
| chat_turns 多轮 token 累积 | 超 8K context | 限制最近 5 轮 + 老轮 summarize |

## 11. 实施顺序 (推荐分 6 PR)

| PR | 内容 | 验收 |
|---|---|---|
| PR1 | embedder.js + test-embed.js | `npm run test:embed` 跑通, 中英文都能出向量 |
| PR2 | vec-store.js + sqlite-vec 集成 + migration | upsert/search 单测通过 |
| PR3 | indexer.js + 全量索引脚本 | `npm run index:all` 跑完, embeddings 表有 579+ 行 |
| PR4 | retriever.js + buildChatMessages 重构 | `npm run chat -- "夜里"` 跑通, 看到 RAG context |
| PR5 | llm-adapter messages[] + index.js 接入 | 端到端 chat 跑通, prompt < 12KB |
| PR6 | budget-enforcer + 反幻觉 checker | source_pool 偏差 < 10%, reason 100% 锚 evidence |

## 12. 可选: vibe-anchors.md

如果用户写一份 `user/vibe-anchors.md` (~30 个 vibe × 5 句话), RAG 召回质量会有明显提升:

```markdown
## 夜里 (00:00-02:00, 一个人, 灯关)
偏沉、空、慢. Xiu Xiu / Burial / Grouper 是核心锚.
不要: 任何 indie pop / 任何带清亮 vocal hook 的.

## 通勤 (早高峰地铁)
要 bpm 110-130. Frank Ocean / Lola Young / SZA / 早期 The Weeknd.
不要: 太冷的 ambient / instrumental.
```

不写也能跑, 但 chunk 是 RAG 检索质量的最大单一杠杆.

## 13. 不在本期 (列为后续)

- M8 周度收敛 (反馈 → MD diff cards)
- DeepSeek streaming 响应
- 反馈跨 session 链路可视化 (Profile view)
- Mac 迁移 (Apple Music 直接读)
- 多模型路由 (Qwen 备份)

---

## 决策记录

| 决定 | 取舍 | 时间 |
|---|---|---|
| embedding 用本地 BGE-M3 q8 | 零成本 + 隐私 vs 启动慢 + 内存大. 用户选本地 | 2026-05-28 |
| 缓存放 D:/Elliot/新建文件夹/.cache | 用户 C 盘空间不足 | 2026-05-28 |
| 向量库用 sqlite-vec | 跟现有 state.db 同进程, 零运维 vs 性能上限 | 2026-05-28 |
| 中国镜像 hf-mirror.com | 主站慢/不稳 | 2026-05-28 |
| messages[] 多轮替代 single prompt | 必须做, 否则对话无连贯性 | 2026-05-28 |
| budget 在 server 强制 vs 只 prompt 提示 | 强制. prompt 提示无效已经验证 | 2026-05-28 |

---

**Review checklist** (供 Elliot 检查):
- [ ] 11 个章节是否覆盖了全部 4 个痛点
- [ ] 是否漏掉了任何当前可用的功能 (例如某个 slash 命令)
- [ ] 模块拆分是否合理 (是否有 god module)
- [ ] 实施顺序 6 个 PR 是否过细/过粗
- [ ] 性能预算是否激进 (5-8s chat 是否能达到)
- [ ] 是否真的要写 vibe-anchors.md
