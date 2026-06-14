# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目是什么

Nightliner（夜线电台）：跑在 `localhost:8080` 的本地 PWA，在网易云音乐之上做一层私人 AI DJ——LLM 决定播什么、为什么播、播完学到什么。**完全为单一用户（Elliot）私人订制，不通用化。** 纯 JS（Node 20+，ESM），无构建步骤（前端除外）。

## 单一事实来源

**[nightliner-design-v0.5.md](nightliner-design-v0.5.md) 是 as-built 设计文档，架构问题先读它**（一次 /api/chat 全程、探索档位表、方向硬约束、RAG、LLM 契约、文件结构都在里面）。v0.3 是未落地的愿景稿，README.md 部分内容已过时（仍写着 claude-adapter / ANTHROPIC_API_KEY，实际是 deepseek + llm-adapter）——冲突时以 v0.5 和代码为准。

## 维护纪律（每个 session 必须遵守）

1. **任何改变推荐 / 方向 / 播放行为的修改，必须在同一次工作中同步更新 nightliner-design-v0.5.md 对应小节。** 文档与代码冲突时改文档。
2. **每完成一个独立功能 / 修复就 commit 一次**（Conventional Commits：feat/fix/docs/chore/test，scope 常用 dj/rag），**commit 后顺手 `git push`**（远端 origin = github.com/chaojifeixia111/nightliner，私有仓库）。不要攒多个功能进一个 commit。session 结束前工作区应当干净。
3. 改 DJ 行为优先改 `prompts/*.md`，不动代码；改探索行为看 `server/exploration-modes.js` 与 `server/direction.js`。

## 常用命令

```bash
npm start                  # 后端 :8080（= node --env-file=.env server/index.js）
npm --prefix pwa run dev   # Vite 前端热更新 :5173（代理 /api、/stream 到 :8080）
npm --prefix pwa run build # 生产构建 → pwa/dist（后端静态托管）

npm test                                          # 全部后端单测（node:test，串行；自动用 :memory: 库，碰不到生产 state.db）
node --env-file=.env --test tests/<file>.test.js  # 单个测试文件（同样隔离，靠 NODE_TEST_CONTEXT 检测）
node --env-file=.env scripts/smoke-rag.js         # 两轮端到端冒烟

npm run index:all          # RAG 全量/增量索引重建
npm run chat -- "消息"     # 命令行单轮对话（不起前端）
```

前置条件：`.env` 提供 `DEEPSEEK_API_KEY`；NeteaseCloudMusicApi 跑在 :3000（`scripts/start-ncm-api.ps1`）；`data/netease-cookie.txt` 有效。

## 大局架构（细节见 v0.5 文档）

三进程：后端 :8080（Express + ws）、NeteaseCloudMusicApi :3000（社区项目）、Vite :5173（仅开发）。LLM 是 DeepSeek（OpenAI 兼容 SSE），`llm-adapter.js` 按模型名前缀路由 claude/deepseek/qwen。

一次 `/api/chat` 的管线（每步对应一个 server/ 模块）：

```
方向解析(direction.js) → 候选池(recommend 缓存 + explore-pool) + RAG 召回(retriever)
→ 拼 prompt(context-builder) → 流式 LLM(llm-adapter，prose-then-JSON)
→ 确定性对齐(align-batch.repairFamiliarNew) → reason 幻觉遮蔽(budget-enforcer)
→ 解析直链(playback-coordinator，只取原唱) → 更新 queue/now + ws 广播
```

必须理解的三条不变式：

- **方向硬约束 > 探索档位**：用户点名语种/性别/艺人后，本批每首必须落在方向内；换不到方向内候选就丢弃（宁短勿偏），绝不跨方向凑数、绝不谎报语种。纠正/追问沿用方向，明确"随便/放开"才清空。
- **探索行为由 `exploration-modes.js` 的 5 档配方决定**，`config.yaml` 里 `take_song`、`rag.budget_enforcement`、`consolidation`、`models.radio_mode` 全是 legacy、不被读取——别被误导。
- **Agency 原则**：网易云 `/simi/song`、每日推荐只是候选生成，agent 自己去重/过滤/重排，绝不照搬外部排序。

存储：`data/state.db`（SQLite + sqlite-vec，播放事件/反馈/对话轮/向量）。`data/` 与 `user/` 整体 gitignore（含网易云 cookie 凭证与用户隐私文件）。会话态（currentQueue/now/currentDirection/tuning）在 index.js 内存里。

每次 LLM 调用全量落盘 `data/llm-calls.jsonl`——调 prompt 问题先看它。
