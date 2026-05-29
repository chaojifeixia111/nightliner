# Nightliner · 夜线电台 设计文档 v0.3

> ⚠️ **历史文档(原始愿景)。** 当前真实实现见 [nightliner-design-v0.5.md](nightliner-design-v0.5.md)。本文描述的 macOS + Apple Music(AppleScript)+ MediaRemote daemon + Claude + 周度 consolidation 等多数**未落地**(实际已转 Windows + 网易云直链 + deepseek + RAG)。保留作为北极星与设计推理留痕。

> **用途**:直接交付 Claude Code 启动开发使用。
> **基于**:v0.1(初始架构对话)+ v0.2(CC 草案)+ v0.3 多轮讨论(Apple Music 协调层、信号采集层、动态 queue、记忆考古涌现式生成)。
> **风格约束**:完全私人订制,所有设计倾向"为 Elliot 一人服务",不考虑通用化、多用户、产品化包装。
> **目标平台**:macOS 优先(v0.1),iPhone 通过 Last.fm 间接覆盖(无需独立客户端)。

---

## 一、产品定位

### 1.1 形态:Apple Music 之上的智能 DJ 协调层

**Nightliner 不是音乐播放器替代品**,它是一个跑在 `localhost:8080` 的本地 PWA,**在 Apple Music 之上**做以下事:

- 推荐音乐(语义推理 + 私人规则 + 记忆检索)
- 协调播放(通过 AppleScript 操控 Apple Music)
- 解读你听歌行为(通过 MediaRemote + Last.fm 收集数据)
- 维护你的音乐人格档案(taste.md / mood-rules.md / life-stages.md)

**音频从 Apple Music 出**,不从 PWA 出。Apple Music 的所有原生体验(空间音频、Lossless、AirPods、CarPlay、HomePod AirPlay)全部保留,Nightliner 只在 Apple Music 之外**加一层"AI 协调"**——即"决定播什么、为什么播、播完之后我学到了什么"。

例外:**网易云作为版权补丁源**,在 Nightliner PWA 内通过 `<audio>` 直链内嵌播放(因为网易云非官方 API 给直链)。

### 1.2 北极星

> **翻出那些你已经忘了,但听到会确认"我以前真的爱过"的歌。**

这个目标是 Spotify / Apple Music 算法本质上做不到的——它们的算法服务"现在的你",不会主动从你五年前的播放记录里翻出一首你已经忘了的歌端到你面前。这是 LLM agent 才能做的事。

### 1.3 双模式

| 模式 | 触发 | Claude 输出形态 |
|------|------|----------------|
| **电台模式** | 用户选了一个种子方向、模式 chip,或继续上一段 queue | `say + play[N 首] + 下次唤醒时机` |
| **对话模式** | 用户在底部输入框打字 | `say + play[]`,本轮结束后等待下一句 |

两种模式共用同一个 Claude、同一个 state.db、同一个播放器协调层,只是 prompt 模板不同。打字 = 立刻打断当前 queue,触发动态重写或单首插入。

### 1.4 明确不做(防止 CC 自由发挥)

- ❌ TTS 语音合成(MVP 用字幕代替)
- ❌ 多用户、账号系统、引导流程
- ❌ Spotify 接入
- ❌ Apple MusicKit JS 内嵌播放(需要 $99 Developer 账号,以后再说)
- ❌ 主动 SCHEDULER(早间规划、小时情绪检查放 v2)
- ❌ iOS 原生 App(iPhone 通过 Last.fm 间接覆盖,Nightliner 本体只在 macOS)
- ❌ 通用化:不要在文案、配色、引导上做"让别人也能用"的让步

---

## 二、架构总览

### 2.1 五层结构

```
┌─────────────────────────────────────────────────────────┐
│ 第五层 · UI 表层(PWA, localhost:8080)                  │
│   Player + Chat 输入 + Profile + Settings + 模式 chip   │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│ 第四层 · Nightliner 后端(Node.js)                      │
│   router / context / claude-adapter / queue-manager     │
│   playback-coordinator / consolidation-runner / state.db│
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│ 第三层 · 协调器(AppleScript + 内嵌 audio)             │
│   Apple Music(临时歌单 + AppleScript 控制)            │
│   网易云直链(<audio> 标签内嵌,补丁源)                 │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│ 第二层 · 信号采集(后台守护)                            │
│   MediaRemote daemon(macOS 全 App 实时监听)           │
│   Last.fm puller(每小时增量拉历史 scrobble)           │
└─────────────────────────────────────────────────────────┘
                         ↕
┌─────────────────────────────────────────────────────────┐
│ 第一层 · 数据源                                          │
│   网易云 API(NeteaseCloudMusicApi 自部署)             │
│   iTunes Search API(公开,免 Developer)                │
│   Apple Music 数据导出(privacy.apple.com 一次性 ZIP)  │
│   Last.fm API                                            │
│   Claude(claude -p 子进程,按任务分层路由)             │
└─────────────────────────────────────────────────────────┘
```

### 2.2 文件结构

```
nightliner/
├── server/
│   ├── index.js                    # Express 主入口 + WS
│   ├── router.js                   # 意图分流(轻指令 / 电台 / 对话)
│   ├── context-builder.js          # prompt 6 块拼装
│   ├── claude-adapter.js           # claude -p 子进程 + 模型路由
│   ├── queue-manager.js            # 流式分段生成 + 动态重写
│   ├── playback-coordinator.js     # AppleScript + 网易云直链
│   ├── consolidation-runner.js     # 周度 / 200 事件触发
│   ├── ncm-client.js               # NeteaseCloudMusicApi 适配
│   ├── itunes-search.js            # iTunes Search API
│   └── lastfm-client.js            # Last.fm API
├── daemons/
│   ├── mediaremote-daemon/         # 独立进程,launchd 启动
│   │   ├── main.swift              # 或 Node + native binding
│   │   └── README.md
│   └── lastfm-puller/              # 由主进程调度,不独立
├── pwa/
│   ├── views/
│   │   ├── Player.vue
│   │   ├── Chat.vue                # 嵌在 Player 底部,非独立路由
│   │   ├── Profile.vue
│   │   └── Settings.vue
│   ├── App.vue
│   └── main.js
├── prompts/
│   ├── dj-persona.md               # DJ 人格(用户填写)
│   ├── radio-mode.md               # 电台模式 prompt 模板
│   ├── chat-mode.md                # 对话模式 prompt 模板
│   ├── consolidation.md            # consolidation pass 模板
│   ├── cold-start-taste.md         # 冷启动:taste.md 生成模板
│   ├── cold-start-life-stages.md   # 冷启动:life-stages.md 模板
│   └── signal-interpretation.md    # 信号语义解读模板
├── user/
│   ├── taste.md                    # 系统主写,用户审 diff
│   ├── mood-rules.md               # 用户手写为主
│   ├── life-stages.md              # 涌现式生成,用户认领命名
│   └── playlists.json              # 种子歌单引用
├── data/
│   ├── state.db                    # SQLite 主库
│   ├── lastfm-history.json         # 一次性历史快照
│   ├── apple-privacy-import.csv    # privacy.apple.com 导入
│   └── llm-calls.jsonl             # 每次 Claude 调用日志
├── config.yaml                     # 用户可调参数集中点
└── package.json
```

---

## 三、播放体系(核心)

### 3.1 主源策略

| 顺序 | 源 | 角色 | 播放方式 |
|------|------|------|----------|
| 1 | **Apple Music** | 主力 | AppleScript 控制 Apple Music App |
| 2 | **网易云** | 版权补丁 | Nightliner PWA 内嵌 `<audio>` 直链 |

**版权决策流程**:Claude 输出一首歌 →
1. 调 iTunes Search API 查 Apple Music 是否有 → 有则走 Apple Music
2. 没有则查网易云 → 有则在 PWA 内嵌播放
3. 都没有 → 这首从 queue 中删除

### 3.2 Queue 生成:流式分段,外部单一歌单

**底层原则**:Apple Music 看到的是一个**完整歌单**,但 Claude 是分段生成的——保证响应速度 + 后段可根据反馈调整。

**默认 queue 长度 10 首,可在 Settings 调到 5-30 首。** 不论多长,内部按 5 首一段处理。

**生成时序(以 10 首为例)**:

```
T=0s     用户触发"开始播放"
T=0-3s   Claude 生成第 1 段(歌 1-5)+ 后续段的"种子方向"
T=3s     AppleScript 创建临时歌单,写入歌 1-5,启动播放
T=3s+    用户开始听歌 1
         同时 Nightliner 后端在后台:
         - 监听 MediaRemote 当前播放进度
         - 当歌 3 进入播放(约 T=3min 后),Claude 生成第 2 段(歌 6-10)
         - AppleScript append 歌 6-10 到同一临时歌单
         Apple Music 视角:它从未"切换 queue",只是歌单在背景里变长了
歌 10 播完,queue 结束,Apple Music 停止,Nightliner 通知"queue 结束,要继续吗?"
```

**用户感知**:**点播放 → 3 秒后开始第一首 → 之后 10 首歌全程无空隙连播**,和原生 Apple Music 自动播放下一首没有任何区别。

### 3.3 Narrative 衔接(DJ 字幕)

字幕条**和音频流独立**,不影响播放节奏。规则:

- 第 1 首开播时显示开场 say(整批 queue 的总开场白)
- 段间(第 5 → 6 这种)字幕条显示衔接 say(可选,Claude 决定是否需要)
- 单首切换时,字幕条更新为本首的 reason / memoryLink(如果有真实关联)
- 用户主动操作(暂停、跳过、说话),字幕条响应

字幕条是 PWA 里的 UI 元素,不影响 Apple Music 播放本身。

### 3.4 临时歌单生命周期

**命名规则**:`__nightliner_queue_{YYYYMMDD_HHMMSS}`(双下划线前缀避免与用户真实歌单混淆)。

**所属位置**:Apple Music 中放进一个固定的 Folder 叫 `Nightliner`(用户在 Apple Music 里可以一眼看到所有 Nightliner 临时歌单都集中在这里,不污染主 library)。

**清理策略(双层)**:

1. **即时清理**:监听到当前临时歌单最后一首播完(MediaRemote 的"播放结束"事件 + 当前曲目是 queue 末尾),AppleScript 删掉这个歌单。
2. **启动兜底**:Nightliner 主进程启动时,扫描 `Nightliner` folder,所有超过 24 小时的 `__nightliner_queue_*` 歌单一律删除。

正常情况下 user library 永远只同时存在 0-1 个 Nightliner 临时歌单。

### 3.5 跨源处理:删除策略

Claude 推一组歌(比如 10 首),iTunes Search 查询后:

- **全部 Apple Music 命中**:直接走 Apple Music,完美。
- **N 首 Apple Music 命中,M 首仅网易云有**:
  - 将"仅网易云有"的 M 首**直接从 queue 删掉**
  - 剩下的 N 首走 Apple Music,作为完整 queue
  - DJ 字幕里**不解释删除原因**,正常播放体验
- **没 Apple Music 命中数 < 50%**:见 §3.6 兜底。

### 3.6 极端情况兜底:Apple Music 覆盖率不足

某些 niche 场景下(用户说"放点冷门华语独立"、"早期民谣"),Apple Music 覆盖可能很低。

**判定阈值**:Claude 推一组歌,iTunes Search 命中率 < 50%。

**响应**:
- DJ 主动声明:"这批歌 Apple Music 上不全,这次给你切到网易云内嵌播放"
- 整批 queue 在 Nightliner PWA 内嵌 `<audio>` 播放(网易云直链)
- Apple Music 不参与本批
- 下一批 queue 重新尝试 Apple Music 优先

这个 fallback 自动触发,**不需要用户配置**。

### 3.7 动态 queue 管理

#### 3.7.1 "换一批"(重写后半段)

用户说:"换一批,这批太丧了" / "换个调调"

**后端动作**:
1. 接收当前播放位置(歌 N,播放进度 t)
2. Claude 接到指令 + 上下文(已播过的 1..N + 已生成未播的 N+1..end)
3. Claude 生成新的 N+1..end(避免用户刚反馈的方向)
4. AppleScript 把临时歌单的 N+1 之后的轨道**替换**为新生成
5. 当前歌 N 不动,正常播完后自动进入新的 N+1

**用户感知**:当前歌不被打断,后面静默换了。

#### 3.7.2 "下一首播 XXX"(精准插入)

用户说:"下一首播《下雨天》"

**Claude 推理过程**(在 prompt 里要求):
1. 判断:**临时插入**(这一首,完了回原 queue)还是**改方向**(从这首开始整批换)
2. 措辞模糊时,DJ 在字幕条问一句:"《下雨天》之后还要继续这种感觉吗?"
3. 查 Apple Music 是否有 → 有,AppleScript 插入到当前歌之后位置;没有,DJ 提示"《下雨天》Apple Music 没有,要不要这一首切到网易云,然后回 Apple Music 继续?"
4. 用户确认后执行

**单首跨源切换可以接受**,因为是用户主动要的。系统级体验:Apple Music 暂停 → 网易云内嵌播 → 这首完 → Apple Music 继续。中间会有 1-2 秒切换间隔,可接受。

#### 3.7.3 "删掉这首" / "别再播这首"

四个反馈按钮之一,详见 §四 信号采集。

#### 3.7.4 基础控制

| 指令 | 实现 | 延迟 |
|------|------|------|
| 暂停 / 继续 | AppleScript `pause/play` | <100ms |
| 上一首 / 下一首 | AppleScript `previous track/next track` | <100ms |
| 音量 | AppleScript `set sound volume to N` | <100ms |
| 跳到指定时间 | AppleScript `set player position to N` | <100ms |

这些**直接控制不走 Claude**,纯路由。

### 3.8 网易云内嵌播放(补丁源)

当 queue 整批 fallback 到网易云,或单首跨源切换到网易云:

- Nightliner PWA 拉网易云直链,塞 `<audio>` 标签
- 播放控制走 PWA 本地(暂停 / 进度 / 音量)
- 这一首期间,Apple Music 处于暂停状态
- 这一首结束,如果原 queue 还有,Apple Music 继续播下一首
- MediaRemote 守护进程**仍然记录这首歌的播放事件**(因为 MediaRemote 不区分来源 App)

---

## 四、信号采集体系

### 4.1 三层信号源

| 层 | 工具 | 覆盖范围 | 信号类型 | 关键能力 |
|----|------|----------|----------|----------|
| 实时 | **MediaRemote daemon** | macOS 全 App | 播放开始 / 结束 / 自然结束 vs 用户跳过 / 进度 | **跳过信号(关键)** |
| 长期 | **Last.fm** | 跨设备(macOS + iPhone via Marvis Pro)+ 永久 | 听完事件(scrobble 阈值后) | 跨设备 + 永久档案 |
| 显式 | **Nightliner 内反馈** | Nightliner 内 | 喜欢 / 不对味 / 太熟了 / 别再播 | 用户主观信号 |

**三者互补,缺一不可**。

### 4.2 MediaRemote 守护进程

**形态**:独立进程,launchd 后台启动,Nightliner 主进程读它的事件流。

**核心数据**:每次播放状态变化,推一条事件到 state.db:

```json
{
  "ts": 1715156100,
  "source_app": "Music",          // 或 "Spotify", "NeteaseMusic" 等
  "title": "稻香",
  "artist": "周杰伦",
  "album": "魔杰座",
  "duration_sec": 232,
  "event": "started" | "ended" | "paused" | "resumed",
  "ended_at_sec": 32,              // event=ended 时给出实际播了多久
  "ended_reason": "natural" | "user_skip" | "app_close" | "next_track"
}
```

**关键判别**:`ended_reason` 是 MediaRemote 协议给的,Nightliner 不需要自己推断。`natural` = 听到自然结束;`user_skip` = 用户在中途主动切了。

**实现参考**:[`media-control`](https://github.com/ungive/mediaremote-adapter) 或 [`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli) 这类开源工具,Claude Code 在此基础上封装一个事件推送进程即可。

### 4.3 Last.fm

**冷启动**:如果用户有 Last.fm 账号,一次性拉 `/user.getRecentTracks`(可拉到账号注册起的全部历史)。这是 life-stages.md 时间锚定的金矿。

**持续同步**:每小时增量拉一次新 scrobble,追加到 state.db。

**iPhone 覆盖方案**:用户在 iPhone 装 [Marvis Pro](https://apps.apple.com/app/marvis-pro/id1447768809)(¥45 一次性买断),配置一次 Last.fm scrobbling,以后所有 iPhone 上 Apple Music 的播放自动 scrobble 到 Last.fm,Nightliner 通过 API 拉到。**这是覆盖 iPhone 听歌的唯一可行方式**——iOS 沙箱不让 Nightliner 直接监听 iPhone MediaRemote。

**⚠️ Last.fm 有的限制**:scrobble 阈值是"听够 50% 或 4 分钟,以先到为准"——**短于这个阈值的播放不进 Last.fm**。也就是说,**Last.fm 上没有"跳过"信号**。这正是为什么必须搭配 MediaRemote。

### 4.4 Nightliner 内反馈

**Player 视图四键反馈**:

| 按钮 | 含义 | 后端行为 |
|------|------|----------|
| ❤️ 喜欢 | 强正反馈 | state.db 标记,提升此歌 + 此 reason 模式权重 |
| 💢 不对味 | 强负反馈 | 标记 + 当前歌跳过 + Claude 重选 queue 后段 |
| 🔁 太熟了 | 短期降权 | 此歌进 cooldown(3 个月不再推),不进 anti-list |
| 🚫 别再播 | 永久禁播 | 此歌进 anti-list,后续 Claude 选歌避开 |

按钮在 Player 视图常驻,点击立即生效。

### 4.5 信号语义解读(LLM 推理层)

**核心思想**:MediaRemote 给原始数据,Last.fm 给账本,**怎么解读这些数据为情感信号,是 Claude 在 consolidation pass 的工作**。

**判别维度**(在 `prompts/signal-interpretation.md` 里写明):

| 信号特征 | 推断 | 写入哪 |
|---------|------|-------|
| 30 秒内跳过 | 强烈不喜欢 / 不对味 / 不在状态 | 强负反馈 |
| 30s-50% 跳过 | 一般不喜欢 / 听腻 | 弱负反馈 |
| 50%-90% 跳过 | 大概不错但不想听完 | 中性 |
| 90%+ 跳过 | 几乎听完才切,大概赶时间 | 接近正反馈 |
| 完整听完 | 至少没拒绝 | 弱正反馈 |
| 听完后立刻重播同一首 | 强烈喜欢 | 强正反馈 |
| 同一首 7 天内播 5+ 次 | 当前循环单曲 | 短期热度,不是长期偏好 |
| 这个时段反复跳所有这类歌 | 当下不在状态 | 不更新偏好,触发 mood 询问 |

**情境推理**(LLM 才能做的事):

- 周一早晨连续跳 3 首抒情慢歌,但同一周晚上完整听完 → 不是不喜欢,是**早间不要慢歌**,写入 mood-rules.md
- 三个月前红心过的歌这周跳了 → 听腻,加 cooldown,**不进 anti-list**
- 从没红心过的歌推送后跳了 → 不对味,分析"这类"是哪类
- 2024 年大量循环过、2026 年再推就跳 → **阶段性偏好漂移**,写进 life-stages.md 而非 anti-list

---

## 五、Agent 工作流

### 5.1 模型路由

| 触发场景 | 模型 | 原因 |
|---------|------|------|
| 跳过、暂停、音量、上一首 | **不调用 LLM** | 纯规则,零延迟零成本 |
| 电台模式连续播 | **Sonnet** | 上下文已清晰,决策空间窄 |
| 对话模式("我想听点冷静的") | **Opus** | 抽象情绪 → 具体歌曲,Opus 甜点 |
| 周度 consolidation | **Opus** | 长上下文 + 模式提取 |
| 一次性冷启动分析 | **Opus** | 投资性,值得 |

### 5.2 取歌混合策略

| 模式 | 默认比例 | 行为 |
|------|---------|------|
| Library-prefer | 70% | Claude 自由出,先在 state.db 历史命中,命中即直链;不命中走 search |
| Recommend channel | 20% | 调网易云 `/recommend/songs` + LLM 排序 |
| Wildcard | 10% | Claude 凭世界知识直推,直接 search |

**特殊约束**:**记忆考古模式必须 library-bound** —— Claude 推荐的歌必须在 state.db 历史播放表(网易云 + Last.fm + MediaRemote 累积)里命中过,**不命中不能播**,以保证"这是你以前听过的"承诺成立。

### 5.3 reason 字段双重身份

**强制要求**:每首推荐的 `reason` 字段同时是:
1. **chain-of-thought 痕迹** —— 让模型先在 reason 里想清楚为什么是这首,再确定要不要播
2. **DJ 展示文案** —— 字幕条上呈现给用户

prompt 模板里明确要求:"先在 reason 里写清楚为什么是这首,再确认 play 字段。如果 reason 写不出有说服力的理由,换一首。"

这是几乎免费的质量提升杠杆。

### 5.4 memoryLink 字段约束

**强制要求**:`memoryLink` 字段必须有 state.db 真实事件支撑——比如某段时间内此歌在播放历史里出现过 N 次以上,或在某个 life-stages.md 章节里被显式标记。

**没有支撑时 memoryLink 必须为 null**,**不允许 Claude 推断生成**。

dj-persona.md 里强调:"宁可不说,不要瞎说。"

### 5.5 每次推荐的 JSON 结构

```json
{
  "say": "今晚南宁有点冷,给你来一组安静一点的。",
  "play": [
    {
      "title": "大鱼",
      "artist": "周深",
      "reason": "你近三个月在 22:00-01:00 之间高频播放周深类男声,这首红心过且 60 天没播了",
      "memoryLink": null,
      "confidence": 0.85,
      "source_preference": "apple_music"
    },
    {
      "title": "下雨天",
      "artist": "南拳妈妈",
      "reason": "今晚下雨,mood-rules 里有『下雨可以翻旧歌但不要每次都《下雨天》』,本月还没播过",
      "memoryLink": "可能与高三晚自习期相关(life-stages.md 第 2 章)",
      "confidence": 0.78,
      "source_preference": "apple_music"
    }
  ],
  "modeUpdate": null
}
```

注意:
- `reason` 是可展示解释,**也是 chain-of-thought**(双重身份)
- `memoryLink` 必须有真实支撑,否则 null
- `source_preference` 是 Claude 的建议(`apple_music` / `netease`),最终决定权在 playback-coordinator

### 5.6 Consolidation pass

**触发**:默认每周一次,可在 Settings 切换为"每 200 条事件触发"。

**输入**:
- 最近 N 条 state.db 事件(播放、跳过、反馈)
- 当前 taste.md / mood-rules.md / life-stages.md
- prompts/consolidation.md 模板
- prompts/signal-interpretation.md 解读规则

**输出**:
- taste.md 的 diff 建议
- mood-rules.md 的 diff 建议(可能新增规则,可能升级单首禁播为类禁播)
- life-stages.md 的 diff 建议(可能新增章节、合并章节、修正时间范围)
- Profile 视图的观察卡片(给用户看)

**关键**:**只生成 diff,不直接覆盖**。所有改动通过 Profile 视图卡片审核,用户接受 / 忽略 / 改一句。

---

## 六、用户语料档案

### 6.1 taste.md

**形态**:系统主写,用户审核 diff。

**冷启动来源**:网易云全时段播放聚合 + Apple Music privacy ZIP + Last.fm 历史 → Opus 一次性分析,生成第一版。

**结构**(Opus 自由组织,以下是建议):
- 当前口味总结(2-3 段)
- 常听风格(按比例)
- 高完成率歌曲类型
- 容易跳过的类型
- 时段偏好(早间 / 夜间 / 深夜)
- 旧歌记忆线索(指向 life-stages.md)

### 6.2 mood-rules.md

**形态**:**用户手写为主**(这是 API 数据推不出来的东西)。

**初始建议(用户填写,见附录 B 模板)**:10-20 条私人映射。例:
- 下雨可以翻旧歌,但不要每次都播《下雨天》
- 写代码时避免清晰中文人声
- 亏钱复盘时不要鸡汤感励志歌
- 想沉一会儿时,不要强行治愈
- 跑步前 10 分钟绝对不放慢歌

后续 consolidation 可能基于反馈数据**新增规则**,但用户原始规则**永不被覆盖,只追加**。

### 6.3 life-stages.md(涌现式生成)

**形态**:agent 自动切分章节 + 用户在使用过程中通过 chat 慢慢认领命名。**用户不需要预先填表**。

**冷启动流程**:
1. Opus 读取 Last.fm 历史 + 网易云收藏 / 红心 / 歌单创建时间(这些都带时间戳)
2. 自动按时间窗口聚类,识别"音乐特征明显不同的时段"
3. 给每个章节起占位名:"2019.6-2020.3 · 高强度华语流行循环期"、"2021 · 电影 OST 探索期"
4. 用户在 Profile 视图看到这些章节,可以**只改命名**(改成"高考备考期"、"看 Interstellar 的那年"),不重新切分

**后续生长**:
- 用户在 chat 说"我大三下学期循环过一首什么钢琴曲,有点像月光奏鸣曲" → DJ 帮找 → 找到后,这条互动写进对应章节的"模糊记忆"段落
- 反馈数据中识别出"阶段性偏好漂移" → 自动新增章节或修正时间范围

**章节数量不预定**——可能 3 章可能 8 章,看数据自然涌现。

**结构**(每章):
```markdown
## {章节占位名 / 用户命名}

时间范围:2019-06 ~ 2020-03
关键事件:[用户填,如"高考备考"]
常见场景:晚自习、深夜独处、周末
音乐锚点:[5-10 首高频曲目,带播放/红心计数]
模糊记忆:[用户在 chat 中确认的旧歌,逐渐积累]
避雷:[这段时期反复跳过的类型]
```

### 6.4 dj-persona.md(含隐私边界)

详见附录 A。关键约束:

> **关于事件字段的口播规范**
> 引用 life-stages.md 中"关键事件"字段时,使用**时段化**而非**事件化**表达。
> ✅ 推荐:"那段日子你常听的"、"那年冬天循环过的"
> ❌ 避免:直接说出"分手"、"考研失利"、"和家人吵架"等具体事件名词
> 原则:**让用户自己想起来,不要替用户复述**。

### 6.5 playlists.json

引用网易云上的种子歌单 ID,用作初始口味注入(冷启动用)。

```json
{
  "seed_playlists": [
    { "id": "1234567890", "label": "我喜欢的音乐", "weight": 1.0 },
    { "id": "2345678901", "label": "晚自习", "weight": 0.7 }
  ]
}
```

---

## 七、UI 设计

### 7.1 Player 视图(主界面)

```
┌─────────────────────────────────────────┐
│ 模式 chip: [南宁雨天 ▼]   ⚙ 调音台     │
├─────────────────────────────────────────┤
│                                         │
│         [封面 280x280]                  │
│                                         │
│ 歌名:大鱼                               │
│ 歌手:周深                               │
│ 来源:Apple Music                        │
│                                         │
│ ━━━━━━━━━━━●━━━━━━━━━━━━━━ 1:24 / 4:33 │
│                                         │
│ ⏮  ⏯  ⏭   🔉━━●━━━                    │
│                                         │
│ DJ 字幕条(打字机效果):                 │
│ "你近三个月在深夜高频播放周深,         │
│  这首红心过且 60 天没播。"              │
│                                         │
│ 反馈:[❤️] [💢] [🔁] [🚫]                │
│                                         │
│ Queue 预览(下一首):                    │
│ → 下雨天 - 南拳妈妈                     │
│   旅行的意义 - 陈绮贞                   │
│   ... 还有 7 首                         │
├─────────────────────────────────────────┤
│ 💬 跟 DJ 说话...                  [发送] │
└─────────────────────────────────────────┘
```

要点:
- 字幕条高度固定(2-3 行),不会因为内容长度跳动
- 反馈按钮即时响应,点击有微动效但不打断播放
- Queue 预览显示下一首 + 总共还剩几首,可以展开看完整 queue
- 底部 chat 输入框**始终在场**,这是杀手级交互

### 7.2 Chat 输入框(嵌在 Player 底部)

不是独立路由,是 Player 的常驻输入层。

例:
- "我想听点高中刷题时候会循环的歌"
- "别太丧,但要旧一点"
- "下一首播《下雨天》"
- "刚才这首不对,太用力了"
- "换一批"

输入即提交,触发 router → Claude 路由,响应通过 WebSocket 推回字幕条。

### 7.3 Profile 视图(卡片审核)

**不是 md 编辑器**。三个区:

#### 7.3.1 观察卡片(consolidation 输出)

```
┌────────────────────────────────────────┐
│ 观察 · 2026-05-08                       │
│                                         │
│ 你最近深夜完整听完了很多慢节奏华语男声, │
│ 但跳过了编曲太满的歌。                  │
│                                         │
│ 是否写入 taste.md?                      │
│ [接受] [忽略] [改一句]                  │
└────────────────────────────────────────┘
```

#### 7.3.2 记忆章节(life-stages.md 渲染)

按时间倒序展示章节卡片。每个卡片:
- 章节命名(可点击编辑)
- 时间范围
- 音乐锚点(top 5 高频曲)
- 模糊记忆条目(列表)
- "找回这段记忆里的旧歌"按钮 → 触发对话模式

#### 7.3.3 规则与禁忌(mood-rules.md 渲染 + anti-list)

按类别分组:
- 时段规则
- 心境规则
- 禁忌(从反馈沉淀的 anti-list)

每条可编辑、删除。**高级入口**:可以查看原始 mood-rules.md 文件内容(给极客用户)。

### 7.4 Settings 视图

v0.1 保持简单:

- **当前模式**(下拉选)
- **Queue 长度**(滑块 5-30,默认 10)
- **探索系数**(滑块,默认 70%)
- **话密度**(滑块,默认 30%)
- **情绪策略**(follow / shift 切换)
- **记忆深度**(滑块)
- **Consolidation 触发**(每周 / 每 200 条事件)
- **数据源开关**:Last.fm / MediaRemote / Apple privacy 导入

底层参数预留,UI 层先做这些就够。

### 7.5 TARS 三层调参

详见 v0.1/v0.2 已讨论。

**最外层 · 模式 chip**(默认看到的):
4-6 个用户人生场景命名的预设。例:`南宁雨天 / 答辩前夜 / 亏钱日的复盘 / 周日漫游 / 英语沉浸 / 深夜温酒`。

**中间层 · chat 输入**(始终在场):
打字临时覆盖当前模式参数,本 session 有效。

**最深层 · 调音台**(齿轮按钮):
5 个滑块(探索系数 / 情绪策略 / 话密度 / 记忆深度 / 人格档案)。调完可"另存为新模式"。

**模式自我生长**:每月 consolidation 自动提议新模式(基于使用模式聚类),用户接受 / 改名 / 微调。

---

## 八、冷启动流程

### 8.1 数据来源

| 数据源 | 获取方式 | 数据内容 |
|--------|---------|---------|
| 网易云全时段聚合 | NeteaseCloudMusicApi `/user/record?type=0` | 每首歌的总播放次数(无时间戳) |
| 网易云红心歌单 | `/playlist/detail?id={喜欢歌单 ID}` | 红心歌曲 + 红心时间(`addedTime`) |
| 网易云用户歌单 | `/user/playlist` + 各歌单 detail | 创建时间 + 内含歌曲 + 添加时间 |
| Apple Music 历史 | privacy.apple.com 一次性 ZIP | 完整时间序列 + 播放次数(等 1-7 天) |
| Last.fm 历史 | `/user.getRecentTracks`(分页) | 全部 scrobble 历史(如有账号) |

### 8.2 处理顺序

1. **网易云数据采集**:登录(扫码)→ 拉全部数据 → 存 `data/netease-snapshot.json`
2. **Apple privacy 导入**:用户提交 ZIP → 解压 → 提取 `Apple Music - Play History Daily Tracks.csv` → 存 `data/apple-privacy-import.csv`
3. **Last.fm 历史**:如有账号 → 拉历史 → 存 `data/lastfm-history.json`
4. **合并归一**:三份数据按"歌名 + 歌手"模糊匹配,合成统一的 listening-history 表写入 state.db
5. **Opus 冷启动分析**:把合并后的数据 + 用户手写的 mood-rules.md 喂给 Opus,生成:
   - `user/taste.md`(第一版)
   - `user/life-stages.md`(占位章节)
   - 初始模式预设(写入 config.yaml)
   - 第一批 Profile 观察卡片

### 8.3 冷启动产物

冷启动跑完后,系统状态:
- state.db 有完整的"过去几年我听过什么"
- taste.md 是 Opus 写的、用户审过的第一版
- life-stages.md 有占位章节(用户慢慢认领命名)
- mood-rules.md 是用户手写的(10-20 条)
- 4-6 个初始模式预设可用

整套冷启动用户参与度:**手写 mood-rules.md(30 分钟) + 扫码登录网易云(1 分钟) + 申请 Apple privacy(1 分钟,等 1-7 天) + 审 taste.md 草稿(15 分钟)**。

---

## 九、HTTP 契约 + 数据结构

### 9.1 API 端点

```
POST /api/chat                    # 用户 chat 输入
GET  /api/now                     # 当前播放状态(WS 推送的初始查询)
GET  /api/queue                   # 当前 queue 完整内容
POST /api/queue/rewrite           # 触发 queue 后段重写("换一批")
POST /api/queue/insert            # 插入单首("下一首播 XXX")
GET  /api/feedback                # 提交四键反馈
GET  /api/profile/cards           # 待审核的观察卡片
POST /api/profile/cards/:id/decide # 接受 / 忽略 / 改一句
GET  /api/profile/life-stages     # 渲染 life-stages.md
POST /api/profile/life-stages/:id # 编辑章节命名
GET  /api/settings
POST /api/settings
WS   /stream                      # 实时推送:字幕、播放状态、queue 变化
```

### 9.2 state.db 关键表

```sql
-- 播放事件流(MediaRemote + Last.fm + Nightliner 内播放统一写入)
CREATE TABLE play_events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,           -- Unix 时间戳
  source_app TEXT,               -- 'Music' / 'NeteaseMusic' / 'Nightliner-NCM' / 'lastfm-import'
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  duration_sec INTEGER,
  played_sec INTEGER,            -- 实际播放秒数
  ended_reason TEXT,             -- 'natural' / 'user_skip' / 'app_close' / 'unknown'
  context_json TEXT              -- 附加上下文(weather, mode, queue_id 等)
);

-- 用户显式反馈
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  song_title TEXT NOT NULL,
  song_artist TEXT NOT NULL,
  signal TEXT NOT NULL,          -- 'love' / 'wrong_vibe' / 'too_familiar' / 'never_again'
  context_json TEXT
);

-- Anti-list(永久禁播)
CREATE TABLE anti_list (
  id INTEGER PRIMARY KEY,
  song_title TEXT NOT NULL,
  song_artist TEXT NOT NULL,
  reason TEXT,
  ts INTEGER NOT NULL,
  scope TEXT                     -- 'song' / 'category'
);

-- Cooldown(短期降权)
CREATE TABLE cooldown (
  id INTEGER PRIMARY KEY,
  song_title TEXT NOT NULL,
  song_artist TEXT NOT NULL,
  cooldown_until INTEGER NOT NULL,
  reason TEXT
);

-- Queue 历史(用于 queue 重写时的上下文)
CREATE TABLE queues (
  id INTEGER PRIMARY KEY,
  ts_start INTEGER NOT NULL,
  ts_end INTEGER,
  mode TEXT,
  songs_json TEXT NOT NULL       -- 完整 play[] 数组
);

-- LLM 调用日志(便于事后调试)
CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  model TEXT NOT NULL,
  trigger TEXT,
  prompt_json TEXT,
  response_json TEXT,
  duration_ms INTEGER
);
```

---

## 十、v0.1 MVP 范围

### 10.1 要做

- 本地 PWA(Vue 3 + Express + WebSocket)
- 网易云 API 集成(NeteaseCloudMusicApi 自部署 + 客户端)
- iTunes Search API 集成
- AppleScript 控制 Apple Music(创建临时歌单 + 播放控制 + 临时歌单清理)
- 网易云直链内嵌播放(`<audio>` 标签)
- MediaRemote 守护进程(macOS launchd)
- Last.fm 客户端(历史拉取 + 增量同步)
- Apple privacy ZIP 导入工具
- 冷启动分析脚本(Opus)
- Player + Chat + Profile + Settings 四视图
- 四键反馈
- Profile 卡片审核
- 模式 chip + 调音台
- Queue 流式生成 + 动态重写 + 单首插入
- Consolidation pass(每周触发)
- 模型分层路由(Sonnet / Opus / 不调 LLM)
- reason 双重身份 + memoryLink 真实性约束
- 隐私边界(dj-persona.md 软约束)
- life-stages.md 涌现式生成

### 10.2 明确不做(防止 CC 自由发挥)

- ❌ TTS 语音合成
- ❌ Apple MusicKit JS 内嵌播放
- ❌ Spotify
- ❌ 多用户 / 账号 / 引导流程
- ❌ 主动 SCHEDULER(早间规划、小时心情检查)
- ❌ iOS 原生 App
- ❌ Android 适配
- ❌ 完整移动端 PWA 打磨
- ❌ 单元测试 / E2E 测试(私人项目,肉眼验证)
- ❌ 复杂错误处理 / 容错(先把 happy path 跑通)
- ❌ 性能优化 / 缓存层

### 10.3 实现顺序(里程碑)

**M1:灵魂文件(0.5 天)**
- 用户填写 `dj-persona.md`(附录 A 模板)
- 用户填写 `mood-rules.md`(附录 B 模板,10-20 条)
- 这两份文件不到 500 字,但是项目灵魂。**没有这俩,后面停下**。

**M2:命令行最小原型(1 天,~150 行)**
- 读两份 md + 写死天气 + 一句用户输入
- 调一次 Opus
- 输出 `{say, play[], reason}` JSON
- **目标:验证 LLM 在此任务上够不够聪明**

**M3:网易云集成(1-2 天)**
- 部署 NeteaseCloudMusicApi
- 写客户端封装
- 把 M2 的 play[] 转成可播放直链
- 命令行版能在本机扬声器播出来

**M4:iTunes Search + AppleScript(2-3 天)**
- iTunes Search API 客户端
- AppleScript 写临时歌单 + 控制播放 + 清理
- 把 M3 升级成 Apple Music 优先 + 网易云补丁

**M5:MediaRemote 守护进程(1-2 天)**
- 基于 nowplaying-cli 或 media-control 封装
- launchd 配置
- 事件流写入 state.db

**M6:冷启动数据汇入(2 天)**
- 网易云数据采集脚本
- Apple privacy ZIP 导入
- Last.fm 历史拉取(如有)
- Opus 一次性分析,生成 taste.md / life-stages.md

**M7:PWA 前端(4-6 天)**
- Vue 3 + WebSocket
- Player(含字幕条 + queue 预览 + 反馈按钮)
- Chat 输入(嵌底部)
- Profile(卡片审核 + 章节 + 规则)
- Settings(基础滑块)
- 模式 chip

**M8:动态 queue + consolidation(3-4 天)**
- "换一批" / "下一首插入" 逻辑
- Queue 流式分段生成
- Consolidation pass 周度触发
- 观察卡片生成 → Profile 审核闭环

**累计:约 14-20 个工作日**,MVP 可以自用。

---

## 十一、给 Claude Code 的特别指引

### 11.1 代码风格

- 简洁、显式、避免过度抽象。私人项目,不需要预留扩展性。
- 不要写"为未来可能用到的功能"做的接口。
- 不要写抽象基类、装饰器、工厂模式之类的。
- 优先用 Node.js 标准库,谨慎引入第三方依赖。

### 11.2 可调参数集中点

所有 prompt 模板、模式预设、阈值集中在:
- `prompts/*.md`
- `config.yaml`

代码里不要硬编码任何 prompt 内容、模型名、阈值数字。改 prompt 不应该需要改代码。

### 11.3 日志详尽

每次 Claude 调用的输入 prompt、输出 JSON、耗时、模型,**全部落盘到 `data/llm-calls.jsonl`**。这对后续调试和 prompt 优化是关键资产。

### 11.4 优先 happy path

- 错误处理只做最低限度
- 没数据时显式失败,不要静默兜底
- AppleScript 调用失败 → 用户能看到错误信息(在 Player 视图)
- 网易云 API 限流 → 显式提示,等待 30 秒重试

### 11.5 不要做的事

- 不要写测试(私人项目,肉眼验证)
- 不要做 i18n
- 不要做无障碍(a11y)
- 不要做性能监控、错误上报
- 不要做用户引导、欢迎页
- 不要做主题切换(暗色模式如有时间再做)

### 11.6 在不确定时

不要"自由发挥"。先在 Profile 视图加一个 "TODO: 这里我不确定,等用户决定" 的卡片,继续 happy path。**用户审 diff 时再决定**。

---

## 附录 A:dj-persona.md 模板(用户填写)

```markdown
# DJ 人格

## 称呼
DJ 怎么称呼用户:Elliot
用户怎么称呼 DJ:______

## 语气倾向
- 默认话密度:30%(每 3-4 首才说一句)
- 句长:短,通常一句话
- 避讳词:______(不要说什么,如"加油"、"治愈"、"陪你")
- 口头禅:______(可以有 1-2 个,也可以没有)

## 风格档位
- archive 档:冷静资料型,只报曲名年份和必要背景
- companion 档:朋友式,会和用户的生活联系起来
- 默认:companion

## 隐私边界(必须遵守)

引用 life-stages.md 中"关键事件"字段时,使用**时段化**表达,
**不直接复述具体事件名词**。

✅ 推荐:"那段日子你常听的"、"那年冬天循环过的"
❌ 避免:"和 X 分手那年常听的"、"考研失利那段反复播的"

原则:让用户自己想起来,不要替用户复述。

## 关于不确定的事

- 不知道的歌不要瞎说历史
- memoryLink 字段没真实数据支撑必须为 null
- 推断口播时,reason 必须有说服力,否则换一首

## 示例口播(用户填 3-5 条)

- 场景:雨天早晨
  口播:"外面在下雨,给你翻出来去年这个时候你循环过的那张专辑。"

- 场景:______
  口播:______

- 场景:______
  口播:______
```

## 附录 B:mood-rules.md 模板(用户填写)

```markdown
# 私人映射规则

## 天气类
- 下雨可以翻旧歌,但不要每次都播《下雨天》
- 大晴天的下午:______

## 时段类
- 周日早晨:老 R&B
- 周一早间:不要抒情慢歌
- 凌晨 1 点之后:______

## 心境类
- 亏钱的日子:励志但不油腻(不要鸡汤味儿)
- 论文卡住的时候:______
- 想哭一会儿:______
- 想沉一会儿时,不要强行治愈

## 场景类
- 写代码时:避免清晰中文人声
- 跑步前 10 分钟:绝对不放慢歌
- ______

## 禁忌
- ______
- ______
```

## 附录 C:life-stages.md 占位结构(系统生成,用户认领)

```markdown
# 人生章节(自动生成草稿,等待认领命名)

## 章节 1 · [占位:2017-2018 早期听歌探索期]

时间范围:2017-09 ~ 2018-08
关键事件:[等待用户填]
常见场景:[Opus 推断]
音乐锚点:
  - 周杰伦 - 稻香(播放 87 次)
  - ...
模糊记忆:[空,等用户用 chat 慢慢补]
避雷:[空]

## 章节 2 · [占位:2019.6-2020.3 高强度华语流行循环期]

时间范围:2019-06 ~ 2020-03
关键事件:[等待用户填]
...
```

## 附录 D:Prompt 模板大纲(CC 在 prompts/ 目录下分别实现)

### D.1 prompts/radio-mode.md(电台连续模式)

```
你是 Elliot 的私人 DJ。

[此处注入 dj-persona.md]
[此处注入 taste.md 摘要]
[此处注入 mood-rules.md]
[此处注入 life-stages.md 摘要]

当前环境:
- 时间:{ts}
- 天气:{weather}
- 模式:{mode_name} + {mode_params}

最近反馈:
{recent_feedback}

最近播放(最近 30 条):
{recent_plays}

任务:为电台连续模式生成下一段 {N} 首歌。

强制约束:
- reason 字段必须先于 play 决定写出。如果写不出有说服力的 reason,换一首。
- memoryLink 字段必须有 state.db 真实事件支撑(在 recent_plays 或更长历史中出现过 N 次以上),否则为 null。
- 引用 life-stages.md 时使用时段化表达,不复述事件名词。
- 推荐的歌应该 70% 在 Library-prefer 范围(用户历史命中过)、20% 来自 recommend channel、10% wildcard。

输出 JSON:
{ "say": "...", "play": [...], "modeUpdate": null }
```

### D.2 prompts/chat-mode.md(对话响应)

类似 radio-mode,加上:
- 当前用户输入 `{user_message}`
- 当前 queue 状态 `{current_queue}` + 当前播放位置
- 输出可能包含 `queueAction`: `rewrite_tail` / `insert_next` / `replace_all` / null

### D.3 prompts/consolidation.md(周度合并)

```
你是 Elliot 的音乐档案管理员。

最近 N 条事件如下:
{events_json}

当前 taste.md / mood-rules.md / life-stages.md 内容:
{current_files}

任务:
1. 按"听腻 / 不对味 / 时段错配 / 阶段漂移 / 待观察"五类对每个跳过事件分类
2. 对每类不超过 10 条最有信号价值的,生成对 taste.md / mood-rules.md / life-stages.md 的 diff 建议
3. 生成 1-3 张 Profile 观察卡片(自然语言,给用户看)

强制约束:
- 不直接覆盖,只输出 diff
- diff 必须可逆(说明改了什么、为什么改、原值是什么)
- 观察卡片用第二人称,不煽情、不过度心理分析

输出 JSON:
{
  "diff_taste": [...],
  "diff_mood_rules": [...],
  "diff_life_stages": [...],
  "observation_cards": [...]
}
```

### D.4 prompts/cold-start-taste.md / cold-start-life-stages.md / signal-interpretation.md

详细模板由 CC 在实现时基于本文档第 §五、§六 节具体写出。

---

## 附录 E:config.yaml 关键参数

```yaml
# 模型路由
models:
  light_command: null              # 不调 LLM
  radio_mode: claude-sonnet-4-5
  chat_mode: claude-opus-4-1
  consolidation: claude-opus-4-1
  cold_start: claude-opus-4-1

# 取歌策略
take_song:
  library_prefer_pct: 70
  recommend_channel_pct: 20
  wildcard_pct: 10
  archeology_mode_must_be_library_bound: true

# Queue
queue:
  default_length: 10
  min_length: 5
  max_length: 30
  segment_size: 5

# 播放协调
playback:
  apple_music_coverage_threshold: 0.5  # 低于此比例 fallback 到网易云
  apple_music_folder_name: "Nightliner"
  temp_playlist_prefix: "__nightliner_queue_"
  temp_playlist_max_age_hours: 24

# Consolidation
consolidation:
  trigger: weekly                  # 或 "every_n_events"
  every_n_events: 200

# 信号解读阈值
signal_thresholds:
  strong_skip_sec: 30              # 30 秒内跳 = 强负
  weak_skip_pct: 0.5               # 50% 内跳 = 弱负
  near_complete_pct: 0.9           # 90%+ = 接近正
  cooldown_after_too_familiar_days: 90
```

---

**文档结束。**

**用法**:
- 这份文档 + `dj-persona.md` + `mood-rules.md`(用户填写完成的)→ 一并交付 Claude Code
- CC 应该按 §10.3 里程碑顺序逐步实现,**M1 卡住不要往后推**(灵魂文件没写出来,代码做了也白做)
