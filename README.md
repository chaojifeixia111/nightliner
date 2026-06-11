# Nightliner · 夜线电台

> 翻出那些你已经忘了，但听到会确认"我以前真的爱过"的歌。

一个跑在 `localhost:8080` 的本地 PWA，在网易云音乐之上做一层私人 AI DJ——决定播什么、为什么播、播完之后学到了什么。完全为单一用户私人订制，不通用化。

技术栈：Node 20+（Express + ws，纯 JS / ESM）· Vue 3 + Vite · DeepSeek（流式）· BGE-M3 本地 embedding + sqlite-vec（RAG）· NeteaseCloudMusicApi。

---

## 快速启动

**前置条件**

1. Node.js 20+
2. NeteaseCloudMusicApi 自部署在 `localhost:3000`（`scripts/start-ncm-api.ps1`）
3. `.env` 文件提供 `DEEPSEEK_API_KEY`
4. 网易云登录态：`npm run ncm:login` 扫码，生成 `data/netease-cookie.txt`

**启动**

```bash
npm start                  # 后端 http://127.0.0.1:8080(启动时 BGE-M3 预热约 3 秒)
npm --prefix pwa run dev   # 开发前端 :5173,热更新,代理 /api 到后端
npm --prefix pwa run build # 生产构建 → pwa/dist,由后端静态托管
```

打开 `http://127.0.0.1:8080`（生产）或 `:5173`（开发），在底部输入框跟 DJ 说话开始。

**常用脚本**

```bash
npm test                   # 后端单测(node:test)
npm run index:all          # RAG 索引全量/增量重建
npm run chat -- "消息"     # 命令行单轮对话,不起前端
```

---

## 文档

- **[nightliner-design-v0.5.md](nightliner-design-v0.5.md)** — as-built 设计文档（单一事实来源）：架构、`/api/chat` 全程、推荐引擎（5 档探索模式 / 方向硬约束 / 反馈衰减）、LLM 契约、HTTP/WS API、存储。
- **[docs/RAG.md](docs/RAG.md)** — RAG 运维手册：起服务、重建索引、看日志、手测。
- `docs/superpowers/` — 历次功能的 brainstorm spec 与 implementation plan（含状态标注）。

## 隐私边界

`data/`（播放记录、网易云 cookie、LLM 调用日志）、`user/`（个人档案）、`.env`（密钥）均不进版本控制。
