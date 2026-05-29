# Nightliner v0.4 · Windows MVP 设计差分稿

> ⚠️ **历史文档(2026-05-08 转向决策)。** 当前真实实现见 [nightliner-design-v0.5.md](../../../nightliner-design-v0.5.md)。本差分稿早于 RAG / 流式 / 探索档位 / 方向硬约束 / deepseek 等改动——其中"模型用 Claude/Opus"、"不做调音台/Settings"、"取歌 70/20/10"均已过时。保留作为转向决策留痕。

> **基于**:[v0.3 完整设计](../../../nightliner-design-v0.3.md) + 5 轮 brainstorming 决策
> **日期**:2026-05-08
> **状态**:待用户审核;审完进入 writing-plans
> **窗口期**:Windows 约 1 个月,然后迁移 Mac
> **核心承诺**:这一个月做的所有代码 100% 可复用到 Mac,**无 Windows 特有的一次性投入**

---

## 一、v0.3 → v0.4 关键差分(一图速览)

| 项 | v0.3 | v0.4(Windows) | 迁 Mac 后变成 |
|---|------|---------------|----------------|
| **平台** | macOS 优先 | Windows 11 | macOS(无缝继承) |
| **主播放源** | Apple Music + AppleScript | 网易云直链 + PWA `<audio>` 内嵌 | 保持网易云为主路径,Apple Music 作为可选增强 |
| **协调层** | AppleScript 控制 Apple Music App | **PWA 自己就是播放器**,无外部协调 | PWA + 加 AppleScript(可选) |
| **信号采集** | MediaRemote daemon + Last.fm | **PWA 自身播放事件**(精度 100%)+ Last.fm | + MediaRemote(覆盖外部 App) |
| **守护进程** | launchd | **没有**(PWA 内置即播即记) | + launchd MediaRemote daemon |
| **iTunes Search API** | 用于 Apple Music 命中查询 | **不用**(主源网易云,无需查命中) | 上线为版权决策路由 |
| **跨设备 iPhone** | Marvis Pro → Last.fm | 同左 | 同左 |
| **范围** | M1-M8 完整 MVP | **M1 + M-init + M2 + M3 + M7-mini**(方案 B) | M4 + M5 + M6 + M7 完整 + M8 增量上线 |
| **life-stages.md** | Opus 时间窗口聚类生成 | **用户已分好三段** → 直接写占位章节 | 增量 consolidation |
| **mood-rules.md** | 用户 30 分钟手填 10-20 条 | **从空开始**,使用过程中追加 | 同左 |
| **Profile / Settings / 模式 chip / Consolidation** | v0.1 MVP 范围 | **不做**(留 Mac) | 上线 |
| **TTS / Apple MusicKit JS / Spotify** | ❌ 永远不做 | ❌ | ❌ |

---

## 二、架构(四层简化版)

v0.3 的五层架构在 Windows 上简化为四层——**信号采集层折叠到协调器内**(因为播放器就是 PWA,事件是自家生成的)。

```
┌─────────────────────────────────────────────────────────┐
│ 第四层 · UI 表层(PWA, localhost:8080)                  │
│   Player(<audio> + 字幕条 + 4 反馈键 + queue 预览)     │
│   Chat 输入(嵌底部)                                    │
│   不做:Profile / Settings / 模式 chip                   │
└─────────────────────────────────────────────────────────┘
                         ↕ WebSocket
┌─────────────────────────────────────────────────────────┐
│ 第三层 · Nightliner 后端(Node.js / Express)            │
│   router.js · context-builder.js · claude-adapter.js    │
│   queue-manager.js · playback-coordinator.js · state.db │
│   不做:consolidation-runner / scheduler                 │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│ 第二层 · 协调器 + 信号采集(合并)                       │
│   ncm-client.js(网易云直链 + 搜索 + 歌单拉取)          │
│   PWA 内嵌 <audio>(自家产生 ended/skip/progress 事件)  │
│   lastfm-puller.js(可选,每小时增量,跨设备账本)       │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│ 第一层 · 数据源                                          │
│   网易云 API(NeteaseCloudMusicApi 自部署)             │
│   Last.fm API(可选,有账号才有)                        │
│   Apple Music 歌单(用户截图导入,见附录 D)             │
│   Claude(claude -p 子进程 · Max 订阅免 API key)        │
└─────────────────────────────────────────────────────────┘
```

**关键简化**:

- **没有 iTunes Search API 这一步**——主源是网易云,推一首歌直接拉直链播,不需要"查 Apple Music 是否有"
- **没有"全部 Apple Music 命中 / N 首命中 / 覆盖率不足"的版权决策路由**——v0.3 §3.5 §3.6 整段不适用
- **跳过/进度/结束信号 100% 精确**——因为是 PWA 自家 audio 标签触发的事件;比 macOS MediaRemote 精度还高(后者要从其他 App 推断)

---

## 三、范围:方案 B 详细 deliverable

### M0 · 项目初始化(0.1 天)

- [ ] `git init` 初始化本地仓库(为 Mac 迁移做准备)
- [ ] 建立 `nightliner/` 目录骨架(参考 v0.3 §2.2,但只创建本月用得到的子目录)
- [ ] `package.json` + Node 20+ 环境

### M1 · 灵魂文件(0.5 天 · 大部分已就绪)

- [x] [user/dj-persona.md](../../../user/dj-persona.md) v0:称呼 Elliot + companion 档(避讳词 / 示例口播待补,DJ 走通用默认)
- [x] [user/playlists.json](../../../user/playlists.json):3 个种子歌单(2 网易云 + 1 Apple Music)
- [x] [user/apple-music-favorites-2024-2026.md](../../../user/apple-music-favorites-2024-2026.md):83 首截图导入
- [ ] `user/mood-rules.md`:**从空模板开始**(已在仓库),使用过程中追加
- [ ] `user/taste.md` / `user/life-stages.md`:M-init 时生成

### M-init · 最快速 taste 冷启动(1 小时 · 用户参与)

1. **网易云扫码登录**(用户操作,1 分钟)——通过 NeteaseCloudMusicApi `/login/qr/*` 端点
2. **拉两个网易云歌单**:
   - `160249544`(2014-2017 早期,记忆考古素材)
   - `945616754`(2017-2023 主流偏好 + 重回忆)
3. **合并 Apple Music 83 首**(已截图导入)
4. **(可选)用户写一段 200-500 字自由口味描述**——可以晚到 M2 之后再补
5. **跑 Opus 一次性分析**:三个歌单 + dj-persona + 自由描述 → 输出 `taste.md` v0
6. **Opus 同时输出 `life-stages.md` 三段占位**(模板见附录 A)
7. **Elliot 审 taste.md 5 分钟**(改 1-2 句即可)

### M2 · 命令行最小原型(1 天 · ~200 行 Node)

- 读 `dj-persona.md / mood-rules.md / taste.md / life-stages.md / playlists.json`
- 拼装 6 片 prompt(系统提示词 / 用户语料 / 环境注入 / 已检索记忆 / 用户输入 / 执行轨迹)
- `claude -p` 子进程调用 Opus(对话模式)
- 输出 `{say, play[N], reason, memoryLink, confidence, source_preference}` JSON
- 终端打印,**目标:验证 LLM 在 Elliot 身上够不够聪明**(v0.3 §10.3 M2 原话)
- 不做播放,只看推荐质量
- llm-calls.jsonl 落盘(v0.3 §11.3)

### M3 · 网易云客户端 + 命令行可播(1-2 天)

- **部署 NeteaseCloudMusicApi**(社区项目,Docker 起 / 或 npm 直接跑)
- `ncm-client.js`:`search` / `song_url` / `lyric` / `playlist_detail` / `playlist_track_all` / `login_qr`
- M2 的 `play[]` → 调 `search` 命中 → 调 `song_url` 拿直链
- M3 阶段验证方式:把 `song_url` 返回的直链直接复制到浏览器地址栏听一首,确认直链可拉、不被防盗链拦(正式的 PWA `<audio>` 内嵌留 M7-mini 做)
- **不做版权决策**——主源是网易云,搜不到的歌从 queue 删掉,DJ 字幕里不解释

### M7-mini · 精简 PWA(2-3 天)

- Vue 3 + Vite + WebSocket
- **只做一个视图**:Player
  - 顶部:歌名 / 歌手 / 来源(永远显示"网易云")
  - 中部:进度条 + 控制(`<audio>` 原生)
  - 字幕条(2-3 行,固定高度,DJ 的 `say` + 当前曲 `reason`)
  - 4 反馈键:❤️ / 💢 / 🔁 / 🚫(写 `state.db` 的 `feedback` 表)
  - Queue 预览(下一首 + 还剩几首)
  - 底部 chat 输入(始终在场)
- **不做**:Profile / Settings / 模式 chip / 调音台 / 暗色主题切换 / a11y / PWA manifest(localhost 用)
- HTTP 契约只实现 v0.3 §9.1 的子集:`POST /api/chat`、`GET /api/now`、`GET /api/queue`、`POST /api/queue/rewrite`、`POST /api/queue/insert`、`POST /api/feedback`、`WS /stream`

### 累计:5-7 个工作日

---

## 四、Mac 迁移检查表(下月做)

**迁移路径**:Windows 期间在本地 git 累积 commits → Mac 上 `git clone` 或 `git pull`(经 GitHub 私有 repo 或 git bundle 文件传输)→ `npm install` → `npm start`。**Windows 期间的代码无需任何移植**。

Mac 上需要新增的工作(预计 5-8 个工作日):

- [ ] **M4** · iTunes Search API + AppleScript 协调层(选做)
  - 决定:Apple Music 升回主源(原 v0.3),还是仅作可选增强
  - 写 `playback-coordinator-applescript.js`(新文件,与 PWA 内嵌共存)
  - 跨源决策路由(版权命中率 + 用户偏好开关)
- [ ] **M5** · MediaRemote daemon(launchd)
  - 基于 nowplaying-cli 或 media-control 封装
  - 事件流写入 state.db(补充 PWA 内嵌之外的播放信号——比如用户在 Music App 里直接播了一首)
- [ ] **M6** · 数据冷启动升级
  - 申请 privacy.apple.com ZIP(等 1-7 天)
  - Last.fm 全历史拉取(如果 Elliot 注册了)
  - 重跑 Opus 冷启动,生成 taste.md / life-stages.md v2(增量,不覆盖 Windows 期沉淀的反馈)
- [ ] **M7 完整版** · Profile + Settings + 模式 chip + 调音台
- [ ] **M8** · Consolidation pass 周度触发 + 观察卡片

---

## 五、保留 v0.3 不变的部分

为避免误解"v0.4 = 全新设计",以下 v0.3 章节**完全继承**:

- §1.1-1.4 产品定位 / 北极星 / 双模式 / 明确不做(Spotify、TTS、多用户、引导流程、SCHEDULER、iOS App)
- §3.7.1-3.7.4 动态 queue 管理("换一批" / "下一首插入" / "删掉这首" / 基础控制)——只是协调实现从 AppleScript 换成 PWA `<audio>` API
- §4.4 四键反馈语义
- §4.5 信号语义解读(LLM 推理层)——精度反而比 v0.3 macOS 方案更高
- §5.1 模型路由(轻指令不调 LLM / Sonnet 电台 / Opus 对话 + 冷启动)
- §5.2 取歌混合策略(70% library-prefer + 20% recommend channel + 10% wildcard)
- §5.3 reason 字段双重身份(chain-of-thought + 展示文案)
- §5.4 memoryLink 真实性约束("宁可不说,不要瞎说")
- §5.5 推荐 JSON 结构
- §6.1 taste.md 形态(系统主写 + 用户审 diff)
- §6.2 mood-rules.md 形态(用户手写为主,只追加,从空开始也合法)
- §6.4 dj-persona.md 隐私边界(时段化表达不复述事件名词)
- §9.1 API 端点 / §9.2 state.db schema
- §11 给 Claude Code 的特别指引(代码风格 / 集中点 / 日志详尽 / happy path / 不做的事)

---

## 六、Apple Music 歌单获取(已通过 HTML 导出解决)

第三个种子歌单(Apple Music Favorite Songs)**不能 API 拉取**(无 Developer 账号 + 无 AppleScript)。

**已用方案**:Elliot 在 Apple Music 网页版打开歌单 → 浏览器另存为 HTML → 用 PowerShell 正则匹配 `aria-label="播放<艺人>的《<歌名>》"` 模式提取所有歌曲 → 与 JSON-LD `<script id="schema:music-playlist">` 的 `numTracks` 字段交叉验证。

**当前状态**:完整 **100 首**(与 JSON-LD `numTracks=100` 一致)→ [apple-music-favorites-2024-2026.md](../../../user/apple-music-favorites-2024-2026.md)。

**M-init 阶段决策**:

- 直接使用 100 首完整列表喂 Opus 分析
- 后续歌单变更时,Elliot 重新导出 HTML → 同样的解析脚本生成新版(脚本可以包到 `scripts/parse-apple-html.ps1` 里复用)
- Mac 之后用 AppleScript 一键拉全(取代 HTML 导出 + 解析,更自动)

---

## 七、待补全清单(用户后续可填,不阻塞开发)

- [ ] `user/dj-persona.md` 第 3 项:3 个避讳词(等 Elliot 想到具体的"听到会皱眉的词")
- [ ] `user/dj-persona.md` 第 4 项:示例口播(草稿已就绪,Elliot 审改一字即可定稿)
- [ ] M-init 时(可选):200-500 字自由口味描述
- [ ] M-init 后:Elliot 审 taste.md(5 分钟)

---

## 八、Windows 期间的 user/ 目录最终态

```
user/
├── dj-persona.md                       # v0 (Elliot + companion + 草稿示例口播)
├── mood-rules.md                       # 空模板(从空开始,使用过程追加)
├── playlists.json                      # 3 个种子歌单引用
├── apple-music-favorites-2024-2026.md  # 83 首 Apple Music 截图导入
├── taste.md                            # M-init 生成,Elliot 审过
└── life-stages.md                      # M-init 生成三段占位
```

---

## 九、附录

### 附录 A · life-stages.md 三段占位生成模板(M-init 用)

```markdown
# 人生章节(M-init 生成,Elliot 认领命名)

## 章节 1 · [占位:早期听歌探索期]
时间范围:2014-2017
关键事件:[等待 Elliot 填]
状态:已不太听,记忆考古素材(出现在记忆考古模式,不进常规电台)
音乐锚点:[Opus 从网易云歌单 160249544 提取 top 10 高频曲]
模糊记忆:[空,等 Elliot 用 chat 慢慢补]

## 章节 2 · [占位:主流偏好期 · 回忆主线]
时间范围:2017-2023
关键事件:[等待 Elliot 填]
状态:主流偏好 + 带重回忆,常规电台高权重
音乐锚点:[Opus 从网易云歌单 945616754 提取 top 10]
模糊记忆:[空]

## 章节 3 · [占位:当前活跃]
时间范围:2024-2026
关键事件:[等待 Elliot 填]
状态:当前活跃,Apple Music 收藏主线
音乐锚点:[Opus 从 83 首 Apple Music 截图提取 top 10]
模糊记忆:[空]
```

### 附录 B · 验收标准

Elliot 审完后回答以下问题应该都是 yes:

1. 这一个月 Windows 上做的所有代码,Mac 上一行都不用改就能继续跑?
2. 是否没有引入 Windows 特有的"一次性投入"(SMTC、Windows 服务封装等)?
3. 是否 mood-rules / Profile / Settings / 模式 chip / consolidation 这些"难写又不影响验证 LLM 智能"的功能都被推后了?
4. 是否 v0.3 的 §1 / §5 / §6 / §9 / §11 这些 LLM 工作流核心章节完全继承?
5. M-init 是否有清晰的"可执行步骤 + 可交付产物"?

### 附录 C · v0.4 不做的事(从 v0.3 §1.4 / §10.2 延伸)

| 不做 | 原因 |
|------|------|
| TTS 语音合成 | v0.3 已排除 |
| Apple MusicKit JS | v0.3 已排除(Developer $99) |
| Spotify | v0.3 已排除 |
| 多用户 / 账号 / 引导流程 | v0.3 已排除 |
| 主动 SCHEDULER | v0.3 已排除 |
| iOS 原生 App | v0.3 已排除 |
| 单元测试 / E2E 测试 | v0.3 已排除(私人项目) |
| **SMTC 守护进程** | v0.4 新增不做:Windows 特有,迁 Mac 即报废 |
| **Windows 服务 / 任务计划程序** | v0.4 新增不做:同上 |
| **Profile 视图(卡片审核 / 章节渲染 / 规则编辑)** | v0.4 新增推后:留 Mac |
| **Settings 视图(滑块)** | v0.4 新增推后:留 Mac |
| **模式 chip + 调音台** | v0.4 新增推后:留 Mac,默认走 chat |
| **Consolidation pass** | v0.4 新增推后:留 Mac |
| **冷启动:Apple privacy ZIP / Last.fm 全历史** | v0.4 新增推后:留 Mac(用快速 taste 路径替代) |
| **完整 life-stages.md 自动切分** | v0.4 新增不做:用户已分好三段,直接占位即可 |

---

**文档结束。**

**下一步**:Elliot 审一遍 → 我做 spec 自审(查 placeholder / 内部一致性 / scope / 歧义)→ 进入 writing-plans 阶段把 5-7 天工作拆成可执行的 implementation plan。
