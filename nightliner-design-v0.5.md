# Nightliner · 夜线电台 设计文档 v0.5(as-built / 现状)

> **用途**:描述 Nightliner **当前真实实现(as-built)**,作为单一事实来源(single source of truth)。
> **版本关系**:
> - [v0.3](nightliner-design-v0.3.md) = 原始愿景(macOS + Apple Music + AppleScript + MediaRemote + Claude),大部分**未落地**,留作北极星。
> - [v0.4 Windows 差分稿](docs/superpowers/specs/2026-05-08-nightliner-windows-mvp-design.md)(2026-05-08)= 转 Windows 的差分决策,平台/播放源准确,但**早于** RAG / 流式 / 探索档位 / 方向硬约束 / deepseek。
> - **本 v0.5 = 实际落地现状**,覆盖以上二者;凡有冲突**以代码为准**。
> **平台**:Windows 11 开发(Node 20+,纯 JS,可无缝迁 Mac)。
> **风格**:完全私人订制,为 Elliot 一人服务,不通用化。
> **最后更新**:2026-06-12。

---

## 〇、与 v0.3/v0.4 的关键差异(先读这个)

| 项 | v0.3 愿景 | **v0.5 现状** |
|---|---|---|
| 主播放源 | Apple Music(AppleScript 控制 App) | **网易云直链 `<audio>` 内嵌,PWA 自己就是播放器**;Apple Music 仅作**数据源**(收藏列表 MD) |
| 推荐模型 | Claude Sonnet/Opus | **deepseek-v4-flash**(DeepSeek API,OpenAI 兼容;adapter 仍保留 claude/qwen 路由备用) |
| 输出契约 | 单个 JSON `{say, play[]}` | **prose-then-JSON 流式**:`say` 先逐字流出,再跟一个 ```json``` 块(不含 say) |
| 取歌策略 | 线性 70% library / 20% recommend / 10% wildcard | **5 档命名探索模式 + 硬对齐 familiar/new + 方向硬约束 + 反馈衰减** |
| 记忆/检索 | 无 | **RAG**:BGE-M3 本地 embedding + sqlite-vec 多路召回 |
| 信号采集 | MediaRemote daemon(macOS 全 App) | **PWA 自身 `<audio>` 事件**(`/api/play-event`、`/api/skip`),精度 100% |
| 运行模式 | 电台模式 + 对话模式 | **只有对话(chat)模式**;电台连播 / AppleScript 连续 queue 未建 |
| 调音台 | v0.1 范围(后 v0.4 标"不做") | **已建**(TuningDrawer:探索档位 / queue 长度;话密度控件已移除,2026-06) |
| 未建/放弃 | — | Profile 视图、consolidation pass、Last.fm、iTunes Search、MediaRemote daemon、mode chips、Apple privacy 冷启动、自动 life-stages 切分 |

---

## 一、运行形态(三个进程)

| 进程 | 端口 | 启动 | 说明 |
|---|---|---|---|
| **Nightliner 后端** | 8080 | `npm start`(= `node --env-file=.env server/index.js`) | Express + ws。启动时 BGE-M3 warmup(~3s)+ 增量索引(~已索引则 <1s)。生产下也由它从 `pwa/dist` **按请求读盘**提供前端。 |
| **NeteaseCloudMusicApi** | 3000 | 社区项目独立起 | 提供 `cloudsearch / song/url / recommend/songs / personal_fm / simi/song / artist/top/song / playlist/*` 等。 |
| **Vite dev(仅开发)** | 5173 | `npm --prefix pwa run dev` | 前端热更新。生产改用 `npm --prefix pwa run build` 产出 `pwa/dist`(已 gitignore)。 |

DeepSeek API 是远端(OpenAI 兼容,SSE 流式)。`.env` 提供 `DEEPSEEK_API_KEY`(凭证,勿入库)。

---

## 二、一次 `/api/chat` 全程(核心数据流)

```
用户在 ChatInput 打字 → POST /api/chat {message}
  │
  1. 方向解析(direction.js)
  │    detectDirection(message, {artistNames}) → {langMatch, gender, artists}
  │    新方向覆盖;明确"随便/放开"清空(isOpenReset);纠正/追问/续批沿用(carriesDirection);
  │    其余全新请求清空
  │
  2. getRecommendPool()(与 RAG 并行)
  │    网易云每日(daily 30)+ 2×personal_fm,按 id 去重,30min 缓存
  │
  3. buildChatMessages(context-builder.js)
  │    a. retrieveContext:把消息(方向激活时用方向词)→ BGE-M3 embed → sqlite-vec 多路 top-K
  │    b. modeForValue(exploration_pct) → 档位 → familiar/new 目标数
  │    c. 方向激活:库内片段从「全量收藏按方向采样」;recommend/explore 池按方向过滤
  │    d. buildExplorePool:种子(方向内收藏曲 / now-playing / RAG)→ simi 近邻 + 同艺人深挖
  │    e. 降权集:skipStats + staleLoves → explore 排除 + prompt avoid-list
  │    f. 拼 system + 最近 5 轮 messages[] + user-turn(填入所有池子/约束)
  │
  4. callLlmStream(llm-adapter.js)
  │    DeepSeek SSE 流式;fence(```) 之前的 prose 逐字 WS 推为 say;整段回来后 splitSayAndJson
  │
  5. repairFamiliarNew(align-batch.js)— 确定性对齐,不重试(零延迟)
  │    跨方向的歌换成方向内候选(新→库内),换不到就丢弃(宁短勿偏,queue 可短);
  │    familiar/new 硬对齐仅在无方向时执行(方向 turn 保留模型选曲与顺序)
  │
  6. checkReasonHallucination(budget-enforcer.js)— 启发式,命中 evidence 外细节则遮蔽 reason
  │
  7. resolvePlayList(playback-coordinator.js)
  │    cloudsearch → pickBest(只原唱)→ song/url(exhigh 320k);无 URL 则丢弃
  │
  8. 更新 currentQueue / now,recordQueue + recordChatTurn(异步 RAG 索引本轮)
  9. broadcast: queue / now / dj_stream_end
```

服务端控制台每轮日志样例:
```
[chat] 方向=中文/国语 · 女声
[chat] intent=recommend, say="方向找对了，这批全是国语女声。..."
[chat] 方向=中文/国语 · 女声 档位=偏探索 目标库内3/全新7 | 模型给库内3 → 校正后库内3/全新7 (换1槽,其中跨方向1)
```

---

## 三、推荐引擎(主功能)

### 3.1 探索档位:5 档命名模式(`server/exploration-modes.js`)

探索系数滑块(0/25/50/75/100)吸附到 5 个命名档位,每档一个明确配方。池子比例**直接来自档位**,不再线性推导。

| 系数 | 名 | en | library% | recommend% | wildcard% | 同艺人深挖 | perSeedCap | 一句话 |
|---|---|---|---|---|---|---|---|---|
| 0 | 舒适区 | Comfort | 100 | 0 | 0 | 0 | 0 | 只放你最爱、最常听的 |
| 25 | 偏熟悉 | Cozy | 75 | 20 | 5 | 2 | 0 | 收藏冷藏曲 + 一点同艺人深挖 |
| 50 | 平衡 | Balanced | 50 | 35 | 15 | 2 | 1 | 一半熟,一半新 |
| 75 | 偏探索 | Venture | 25 | 40 | 35 | 2 | 2 | 大半没听过的,锚在你口味上 |
| 100 | 狂野 | Wild | 5 | 30 | 65 | 1 | 3 | 几乎全新,只留一点底色 |

- `familiarTarget(mode, n) = round(lib/100 × n)`,其余为「全新」。
- **硬对齐**:`repairFamiliarNew` 不信模型自报的 `source_pool`,用真实曲库 `libKeys` 判定每首库内/全新,确定性多退少补(从手边候选池换槽,**不重试**)。这取代了 v0.5-early 的 `enforceSourcePoolBudget`+retry。

### 3.2 方向硬约束(优先级高于档位)— `server/direction.js`

用户点名**语种 / 性别 / 艺人**(如"国语女声"、"英文男声"、"放点孙燕姿")即为**硬约束**,本批每首都必须落在方向内;档位只决定方向内的「熟悉↔全新」配比。

- **检测**:语种关键词(国语/中文/英文/韩语/日语…)+ 性别关键词(女声/男声)+ 点名艺人(匹配曲库艺人名)。
- **`songLang(title)` 以歌名脚本判定**(title-primary):latin 标题 → english,**即使艺人含中文**。这是有意为之——把 "Sad Sometimes"(黄霄雲 feat. 的英文 EDM)排除出"国语",正是踩过的坑。代价:英文标题的粤语/国语歌会漏判(本库极少)。
- **会话延续**:`currentDirection` 存在 index.js,4 分支判定——①新方向覆盖;②明确"随便/都行/放开"清空(`isOpenReset`);③纠正/追问("怎么又是X""第一首不是说放Y吗")与续批("下一批/继续")沿用上轮方向(`carriesDirection`);④其余全新请求清空(防方向卡死在旧请求上)。
- **取数**:RAG 用方向词检索(而非空查询"下一批");库内从**全量收藏按方向随机采样**(每次不同 → 缓解"老推同几首");recommend / explore 池都按方向过滤;explore 种子取方向内收藏曲(→ simi 近邻 + 同艺人深挖天然在方向内)。
- **宁短勿偏**(2026-06,取代早期"比例让位"):跑偏方向的歌优先换成方向内候选(新→库内),候选枯竭则**直接丢弃**——queue 可以短,**绝不用跨方向歌凑满,绝不谎报语种**。方向 turn 不再硬对齐 familiar/new 比例(保留模型选曲与顺序,让"第一首放 X"生效),档位目标仅作 prompt 软引导。
- **server 只保证语种**(脚本启发式);**性别 / 风格交给 LLM**(歌名/艺人名无法可靠判定性别)。一首中文男声可能溜进"女声"请求——可接受,急性的英文乱入已根治。
- 详见 memory: `project_direction_hard_constraint.md`。

### 3.3 三个候选池 + agency 层

| source_pool | 来源 | 说明 |
|---|---|---|
| `library` | RAG 曲库召回 / 方向采样 | 你收藏的歌(网易云快照 + Apple Music MD)。 |
| `recommend` | 网易云每日 daily + 2×personal_fm | 去重、30min 缓存、每轮 shuffle 取 20。方向激活时按方向过滤。 |
| `wildcard` | `explore-pool.js` | **simi 近邻 + 同艺人深挖(deepcut)**。多种子并集、丢弃网易云原序、每种子限量、共识加权 + 随机采样。 |

**Agency 原则**(memory: `feedback_agent_agency_recs`):网易云 `/simi/song` 只作**候选生成**,agent 自己去重/过滤/打散/重排,**绝不照搬外部排序**。explore 排除集 = 已收藏 + anti + cooldown + 最近播放 + 负反馈 + **降权集**。

### 3.4 反馈飞轮 + 衰减(口味时效性)

- **4 键反馈**(写 `feedback` 表 + 异步 RAG 索引):

  | 键 | signal | 后端 |
  |---|---|---|
  | ❤️ 喜欢 | `love` | 记录 + RAG 索引(不永久等权,见衰减) |
  | 💢 不对味 | `wrong_vibe` | 记录;从 explore 排除 |
  | 🔁 太熟了 | `too_familiar` | 进 `cooldown` 90 天 |
  | 🚫 别再播 | `never_again` | 进 `anti_list` 永久禁播 |

- **衰减(2026-05-30)**:
  - 旧 love:RAG 召回里 >90 天的 love 标注「⚠旧爱(可能已过气)」,不当作当前口味。
  - **skip-demote**:`skipStats`(30 天内 user_skip ≥3 次)→ explore 排除 + prompt「近期降权」avoid-list。
  - **stale-love**:`staleLoves`(love 过且 30 天内 skip ≥2 次 =「曾爱现跳」)→ 同上降权。
  - 滚动 30 天窗口,**自动过期**(不写永久 cooldown,口味可回来)。
- **信号源**:PWA 自身 `<audio>` 事件——`/api/play-event`(`natural`)、`/api/skip`(`user_skip`)。**没有 MediaRemote**(那是 macOS 方案,留待迁 Mac)。

---

## 四、LLM 契约

- **prompt 拆分**(RAG 后,触发 DeepSeek prefix cache):
  - `prompts/system.md`(~3KB,跨 session 不变):DJ 人格 + 推歌强约束(reason 锚 evidence / 方向硬约束 / 不重复 RECENT_PLAYS / 避讳词 / 诚实 reason 不编个人史…)+ 输出 schema。
  - `prompts/user-turn.md`(每轮变):用户消息 + now-playing + queue + **方向块** + **探索档位 + 本批 familiar/new 目标** + RAG 召回(库内/recommend/explore/反馈/taste/life-stage/mood/vibe/语义历史)+ anti/cooldown/**降权**/RECENT_PLAYS。
  - 多轮 `messages[]`:最近 5 轮 chat_turns 回放成 user/assistant 对(近因)。
- **prose-then-JSON**:第一步纯文本 = `say`(逐字流式);第二步 ```json``` 块 = `{intent, play[], queueAction, feedback_extract, modeUpdate}`,**不含 say**。
  - `intent` ∈ `recommend` / `chat` / `feedback`。
  - `play[]` 每首:`title, artist, reason, memoryLink, confidence, source_preference, source_pool`。
  - `feedback_extract`(intent=feedback 时):`{target_title, target_artist, target_category, signal, reason}`。
- **provider 路由**(`llm-adapter.js`,按 model 名前缀):`claude-*`→ claude CLI 子进程;`deepseek-*`→ DeepSeek HTTP;`qwen-*`→ DashScope HTTP。**流式仅 deepseek/qwen**(SSE);claude 无流式 → 整段拿回再一次性 emit。
- **每次调用全量落盘** `data/llm-calls.jsonl`:`{ts, model, trigger, prompt(JSON.stringify{system,messages}), response, duration_ms, error}`。这是 prompt 调试的关键资产。

---

## 五、播放解析(`playback-coordinator.js` · `resolvePlayList`)

模型只给 `title/artist`,server 解析成可播直链:

1. `cloudsearch("title artist", limit 5)`。
2. `pickBest`:**只取原唱**——默认滤掉变体(remix/cover/live/伴奏/纯音乐…);先「歌名+艺人精确」匹配,再「剥后缀名+艺人」匹配;找不到原唱则**丢弃**(`[playback] no original version found`)。用户主动要变体(标题自带 remix/live)时才放行变体。
3. `song/url/v1`(`level=exhigh` 320k)。无 URL(VIP `fee=1` / 区域 / 无原唱)→ 丢弃(`found=false`),不进 queue。
4. 并行解析,顺序与 `play[]` 对齐。

**已知取舍**:部分 VIP 独享 / 仅有翻唱的歌会掉队。这是当前已知、未优先处理的缺口。

**手动点播路径(`resolveById`,DAILY / SEARCH 整版页用)**:前端带确定的 `ncm_id` → 跳过搜索,直接 `song/url/v1` 取直链 + `song/detail` 补封面/时长。无直链(VIP/无版权)→ `reason:'unplayable'`;瞬时网络 / NCM 5xx → `reason:'error'`(前端文案区分"放弃"和"重试")。没带 `ncm_id` 时降级走 `resolvePlayList`。

---

## 六、状态与存储

`data/state.db`(SQLite,WAL):

| 表 | 用途 |
|---|---|
| `play_events` | 播放/跳过事件(ts, source_app, title, artist, played_sec, **ended_reason** natural/user_skip…) |
| `feedback` | 显式反馈(signal: love/wrong_vibe/too_familiar/never_again) |
| `anti_list` | 永久禁播(never_again) |
| `cooldown` | 短期降权(too_familiar 90 天) |
| `queues` | queue 历史 |
| `chat_turns` | 对话轮(user_message, intent, dj_say, play_titles, feedback_extract…) |
| `embeddings` / `vec_embeddings` | RAG:元数据+原文 / sqlite-vec 1024 维向量 |

`data/` 其它(均 gitignore):`netease-snapshot.json`(收藏快照)、`apple-music-favorites-2024-2026.md`(收藏)、`tuning.json`(调音台持久化)、`llm-calls.jsonl`(调用日志)、`netease-cookie.txt`(**凭证,勿入库**)。

**内存态**(`index.js`):`currentQueue` / `now` / `playHistory` / **`currentDirection`** / `tuning` / `recommendCache`。

---

## 七、HTTP / WS 契约(现状)

```
POST /api/chat               用户输入(异步,结果走 WS 流)
GET  /api/now                当前 now-playing
GET  /api/queue              当前 queue
GET  /api/tuning             读调音台
POST /api/tuning             写调音台(exploration_pct / queue_length)→ 持久化 + 广播
POST /api/feedback           4 键反馈(title, artist, signal, reason?)
POST /api/play-event         播放结束事件(ended_reason=natural 时自动进下一首)
POST /api/skip               显式跳过(记 user_skip)
POST /api/skip-to            跳到 queue 内指定歌
POST /api/queue/clear        清空待播队列(正在播的歌保留为唯一一项,播完走"queue 结束")
POST /api/previous           回上一首(playHistory)
GET  /api/recommend          今日每日推荐(推荐池 daily 切片,带 ncm_id/pic_url;空了退回整池)
GET  /api/search             ?q=&type=song|artist —— 歌曲(cloudsearch type=1)/ 歌手(type=100)
GET  /api/artist/songs       ?id= —— 歌手热门曲(/artist/top/song)
POST /api/play               手动点播 {title, artist, ncm_id?, mode:'now'|'queue'}
GET  /api/state/anti         anti-list
GET  /api/state/cooldown     active cooldowns
GET  /api/state/history      最近 10 轮 chat_turns
GET  /api/state/stats        反馈/事件计数
WS   (同端口)                广播
```

WS 广播 `type`:`now` / `queue` / `tuning` / `thinking` / `dj_stream_start` / `dj_stream_delta` / `dj_stream_end` / `dj_message` / `stats`。

**手动点播语义**(DAILY / SEARCH 整版页 → `POST /api/play`):`mode:'now'` 把歌插到当前 now 之后并切过去——DJ 队列原样保留,这首播完顺着原队列走;`mode:'queue'` 追加队尾、不动 now(now 为空则直接开播)。队列变更是纯函数(`queue-ops.js`),`recordQueue({mode:'manual'})` 记档。**不校验 anti/cooldown**——用户明确点名就尊重,这些约束只作用于 DJ 出歌的 prompt。play-event 仍由前端 `<audio>` 照常上报,口味学习不断档。

---

## 八、前端(PWA · 单页 Player)

| 组件 | 职责 |
|---|---|
| `App.vue` | WS 连接 + 状态根 + 事件分发(onFeedback/onSkip/…) |
| `HeroCard.vue` | 封面 / 歌名 / 进度 / `<audio>` 控制 / **音量持久化(localStorage `nl_volume`,默认 33)** / ❤ 常驻 + hover 出 × 反馈面板 |
| `TuningDrawer.vue` | **调音台**:探索档位(5 档吸附滑块,显示英文名)/ Queue 长度 |
| `QueueDrawer.vue` | queue 预览 + CLEAR 清空待播(只在有待播歌时显示,正在播的不动) |
| `ChatInput.vue` | 底部常驻输入 |
| `DJLog.vue` | DJ 流式气泡(逐字)+ 系统消息 |
| `AppHeader.vue` | masthead:wordmark + ON AIR + 文字导航 DAILY / SEARCH / QUEUE / TUNING(窄屏 ON AIR 退化为呼吸金点) |
| `DiscoverPage.vue` | **整版页,两个 variant**:DAILY = 今日推荐封面卡网格(无搜索栏);SEARCH = 纯搜索(SONGS/ARTISTS 切换,歌手下钻热门曲,空态只留提示);点卡/行即播、⊕ 排队;Esc/✕ 关闭 |
| `SongCard.vue` / `SongRow.vue` / `ArtistRow.vue` | 封面卡 / 结果行 / 歌手行(playing 金色高亮) |
| `ThinkingIndicator` | 思考中 |
| `ws-client.js` | WS 封装(断线自动重连)+ `sendFeedback` / `playSong` 等 fetch helper |

---

## 九、配置 `config.yaml`(在用 vs legacy)

**在用**:`models.chat_mode`(deepseek-v4-flash)、`ncm.api_base` + `ncm.song_url_level`(exhigh)、`queue.default_length`、`server.*`、`rag.retrieval.*_top_k`、`rag.embedding.*`。

**legacy / 不再读取**(留着无害,别被它误导):
- `take_song`(70/20/10 + `archeology_mode_must_be_library_bound`)→ 已被 `exploration-modes.js` 取代。
- `rag.budget_enforcement`(deviation_threshold / max_retries)→ 已被 `align-batch.js` 的确定性 `repairFamiliarNew` 取代。
- `consolidation`(`enabled:false`)→ 未建。
- `models.radio_mode`→ 无电台模式。

> **探索行为看 `server/exploration-modes.js` 与 `server/direction.js`,不看 config.yaml。**

---

## 十、文件结构(现状)

```
server/
  index.js              Express + ws 主入口;/api/* 路由;会话态(queue/now/direction/tuning)
  context-builder.js    buildChatMessages:RAG + 档位 + 方向 + 池子 + 降权 → {system, messages, meta}
  direction.js          方向检测/匹配/延续(detectDirection, songLang, songMatchesDirection, isContinuation)
  exploration-modes.js  5 档命名模式表 + modeForValue + familiarTarget
  align-batch.js        repairFamiliarNew:方向感知 + familiar/new 硬对齐(确定性换槽)
  explore-pool.js       buildExplorePool:simi 近邻 + 同艺人深挖(agency 层)
  retriever.js          retrieveContext:多路 sqlite-vec 召回
  indexer.js            chunk + indexSong/Feedback/ChatTurn/MdFile + indexAll*
  embedder.js           BGE-M3(@huggingface/transformers ONNX q8)embed/embedBatch/warmup
  vec-store.js          searchSimilar({embedding, source_type, top_k})
  state-db.js           SQLite + sqlite-vec;play/feedback/queue/chatTurn + skipStats/staleLoves + embeddings CRUD
  ncm-client.js         网易云封装(cloudsearch/searchArtists/songUrl/recommend/personalFm/simiSong/artistTopSongs/…)
  llm-adapter.js        callLlm / callLlmStream(SSE)/ splitSayAndJson / extractJson;多 provider 路由
  llm-logger.js         llm-calls.jsonl 落盘
  playback-coordinator.js  resolvePlayList(cloudsearch → pickBest 原唱 → songUrl)+ resolveById(手动点播按 id 直取)
  search-normalize.js   NCM 返回 → 前端统一形状(song/artist)纯函数
  queue-ops.js          playNow/enqueue/clearUpcoming:currentQueue/now 纯变更(手动点播/清空用)
  budget-enforcer.js    checkReasonHallucination(仍用);enforceSourcePoolBudget(legacy,已不在 chat 流程)

prompts/
  system.md             DJ 人格 + 约束 + 输出 schema(~3KB,prefix-cache 友好)
  user-turn.md          每轮模板(方向 / 档位 / RAG 召回 / 降权 / 硬约束)
  chat-mode.md          legacy 单 prompt(仅 cold-start.js / chat-once.js 脚本用)

pwa/src/                Vue3 + Vite(见 §八)

scripts/
  cold-start.js / chat-once.js     一次性分析 / 命令行单轮
  index-all.js / test-embed.js     全量增量索引 / BGE sanity
  smoke-rag.js                     两轮端到端
  ncm-login-qr.js / ncm-fetch-playlists.js   网易云扫码登录 / 拉歌单

data/                   见 §六(全 gitignore)
config.yaml             见 §九
```

---

## 十一、相对愿景:未建 / 放弃(留痕)

- 电台连续模式 / AppleScript / Apple Music 实际播放(现仅网易云 `<audio>`)
- MediaRemote daemon / iTunes Search API / Last.fm 接入
- Profile 视图(观察卡片审核 / 章节渲染 / 规则编辑)
- Consolidation pass(周度收敛 → taste/mood/life-stages diff)
- mode chips(人生场景预设)/ Apple privacy ZIP 冷启动 / 自动 life-stages 切分

这些大多是**迁 Mac 后**或后续要做的,不是被否决——只是当前 Windows 窗口期未建。

---

## 十二、运维速查

- **起服务 / 重建索引 / 看日志 / 手测 chat**:见 [docs/RAG.md](docs/RAG.md)。
- **改 prompt**:只改 `prompts/*.md`,不动代码。
- **改探索行为**:`server/exploration-modes.js`(档位配方)、`server/direction.js`(方向检测/匹配)。
- **改反馈衰减**:`server/state-db.js`(`skipStats` / `staleLoves` 阈值)+ `server/context-builder.js`(降权接线)。

---

**文档结束。** 现状以代码为准;本文档与代码冲突时,改本文档。
