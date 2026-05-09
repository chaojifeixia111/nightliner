# Nightliner · 夜线电台

> 翻出那些你已经忘了，但听到会确认"我以前真的爱过"的歌。

一个跑在 `localhost:8080` 的本地 PWA，在网易云音乐之上做一层私人 AI DJ 协调——决定播什么、为什么播、播完之后学到了什么。

---

## 快速启动

**前置条件**

- Node.js 20+
- NeteaseCloudMusicApi 自部署，运行在 `localhost:3000`（见 `config.yaml` 的 `ncm.api_base`）
- Anthropic API key 设为环境变量 `ANTHROPIC_API_KEY`

**启动后端**

```bash
npm start
# Nightliner server on http://127.0.0.1:8080
```

**开发前端**（热重载）

```bash
cd pwa
npm run dev
# Vite dev server proxies /api 和 /stream 到后端
```

**构建前端**（生产）

```bash
cd pwa
npm run build
# 产物在 pwa/dist，由后端静态托管
```

打开浏览器访问 `http://127.0.0.1:8080`，在底部输入框跟 DJ 说话开始。

---

## 目录结构

```
nightliner/
├── server/
│   ├── index.js                # Express 主入口 + WebSocket
│   ├── context-builder.js      # 拼装 Claude prompt
│   ├── claude-adapter.js       # Anthropic SDK 封装
│   ├── playback-coordinator.js # NCM 搜索 + URL 解析
│   ├── state-db.js             # SQLite (state.db)
│   ├── ncm-client.js           # NeteaseCloudMusicApi HTTP 客户端
│   └── llm-logger.js           # LLM 调用日志
├── pwa/src/
│   ├── App.vue                 # 根组件，WS 消息分发
│   └── components/
│       ├── AppHeader.vue       # NIGHTLINER 标题 + 调音台齿轮
│       ├── ClockCard.vue       # 实时时钟 + ON AIR 指示
│       ├── Player.vue          # 自定义播放器（进度条可拖动）
│       ├── QueuePreview.vue    # 完整 queue 列表（可点击跳转）
│       ├── DJLog.vue           # DJ 对话气泡 + 系统通知
│       ├── ChatInput.vue       # 底部输入框
│       ├── StatusBar.vue       # 固定底栏：FM 标签 + 连接状态
│       ├── TuningDrawer.vue    # 右侧调音台抽屉
│       └── ThinkingIndicator.vue # 思考中三点动画
├── prompts/
│   └── chat-mode.md            # Claude 对话模式 prompt 模板
├── data/
│   ├── netease-snapshot.json   # 网易云曲库快照（勿提交）
│   └── state.db                # SQLite 播放记录（勿提交）
├── user/                       # 私人档案（勿提交）
│   ├── dj-persona.md
│   ├── taste.md
│   ├── mood-rules.md
│   └── life-stages.md
└── config.yaml                 # 所有可调参数
```

---

## API 端点

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/chat` | 发送消息给 DJ，触发选歌 |
| GET | `/api/now` | 当前播放曲目 |
| GET | `/api/queue` | 当前 queue |
| POST | `/api/feedback` | 反馈信号（love/wrong_vibe/too_familiar/never_again）|
| POST | `/api/play-event` | 上报播放事件（PWA 自动调用）|
| POST | `/api/skip` | 跳过当前曲目（记录 user_skip）|
| POST | `/api/skip-to` | 跳转到 queue 中指定曲目 |
| GET | `/api/tuning` | 获取当前调音台参数 |
| POST | `/api/tuning` | 更新调音台参数 |

**WebSocket** `ws://localhost:8080/stream` 推送消息类型：

| type | 说明 |
|------|------|
| `now` | 当前播放曲目变化 |
| `queue` | queue 变化 |
| `tuning` | 调音台参数变化 |
| `thinking` | Claude 思考中（data: true/false）|
| `dj_message` | DJ 发言（kind: opening/song）|
| `stats` | 选歌命中率统计 |

---

## 调音台用法

点击右上角 ⚙ 图标打开调音台抽屉，有三个参数可调：

### 探索系数（0–100，默认 30）

控制 Claude 取歌时从已有曲库之外探索的比例。

- **0%**：全部从你的网易云曲库（397 首）中取歌
- **30%**（默认）：library 70% + 推荐渠道 21% + 随机探索 9%
- **100%**：不受曲库限制，Claude 自由发挥

计算公式：`library : recommend : wildcard ≈ (100-X) : X×0.7 : X×0.3`

### Queue 长度（5–30，默认 5）

每次 Claude 响应生成的歌曲数。较短的队列意味着更频繁的 Claude 调用（每段结束需要再次发起对话），较长的队列可以播更久不用打断。

### 话密度（low / medium / high，默认 medium）

控制 DJ 的开场白长短。`low` = 一两句; `medium` = 正常; `high` = 更详细。这个参数通过 prompt 传递给 Claude，影响 `say` 字段的措辞风格。

调整好后点"应用"即生效，参数实时广播到所有 WS 客户端。

---

## 取歌策略

Claude 按探索系数决定每首歌的来源，并在 JSON 的 `source_pool` 字段标注：

- `"library"` — 歌曲在你的网易云曲库快照中（[P] 早期 / [L] 主线）
- `"recommend"` — 歌手出现在 taste.md 但歌曲不在曲库
- `"wildcard"` — Claude 世界知识发挥

每次 chat 响应后，后端统计并通过 `stats` WS 事件推送命中率（library_hits / recommend / wildcard / vip_skipped / not_found）。

---

## 注意事项

- `data/netease-snapshot.json` 和 `data/state.db` 含个人数据，已在 `.gitignore` 排除
- `user/` 目录同理，不要提交
- 网易云 API 为非官方实现，VIP 专辑可能无法获取播放链接（会在 DJ Log 中以 ⚠ 提示）
