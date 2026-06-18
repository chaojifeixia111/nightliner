# Nightliner · 夜线电台 设计文档 v0.5(as-built / 现状)

> **用途**:描述 Nightliner **当前真实实现(as-built)**,作为单一事实来源(single source of truth)。
> **版本关系**:
> - [v0.3](nightliner-design-v0.3.md) = 原始愿景(macOS + Apple Music + AppleScript + MediaRemote + Claude),大部分**未落地**,留作北极星。
> - [v0.4 Windows 差分稿](docs/superpowers/specs/2026-05-08-nightliner-windows-mvp-design.md)(2026-05-08)= 转 Windows 的差分决策,平台/播放源准确,但**早于** RAG / 流式 / 探索档位 / 方向硬约束 / deepseek。
> - **本 v0.5 = 实际落地现状**,覆盖以上二者;凡有冲突**以代码为准**。
> **平台**:Windows 11 开发(Node 20+,纯 JS,可无缝迁 Mac)。
> **风格**:完全私人订制,为 Elliot 一人服务,不通用化。
> **最后更新**:2026-06-18(对话护栏:方向合并 / fresh 方向重置 / 性别硬校验 / verbatim 保序 / 确认词前置 / play 校验)。

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
  1. 确认词 + 方向解析(direction.js)
  │    整句确认词("嗯/好的/ok")先短路为 chat,不调 LLM、不改 queue、不清 direction
  │    resolveDirectionState(currentDirection, message):
  │    纯续批/纠错里的 partial direction 才做 base ∩ new;新的明确语种/艺人请求重置未提维度;
  │    明确"随便/放开"清空;明确"不限男女"只清性别
  │
  2. getRecommendPool()(与 RAG 并行)
  │    网易云每日(daily 30)+ 2×personal_fm,按 id 去重,30min 缓存
  │
  3. buildChatMessages(context-builder.js)
  │    a. retrieveContext:把消息(方向激活时用方向词)→ BGE-M3 embed → sqlite-vec 多路 top-K
  │    b. modeForValue(exploration_pct) → 档位 → familiar/new 目标数
  │    c. 方向激活:库内片段从「全量收藏按方向采样」;recommend/explore 池按方向过滤
  │    d. buildExplorePool:种子(方向内收藏曲 / now-playing / RAG)→ simi 近邻 + 同艺人深挖
  │    e. 负反馈:wrong_vibe → explore 排除 + avoid-list(skip 不再降权)
  │    f. 口味优先:librarySlice 按 songWeight(love 亲和度)降序排列;explore 种子从 lovedSeeds(4) 开始;user-turn 注入 {{LIVE_TASTE}} 块(affinity.liveTasteBlock —— 近期 love 艺人 + 歌曲,优先于静态 taste.md)
  │    g. 拼 system + 最近 5 轮 messages[] + user-turn(填入所有池子/约束)
  │
  4. callLlmStream(llm-adapter.js)
  │    DeepSeek SSE 流式;fence(```) 之前的 prose 逐字 WS 推为 say;整段回来后 splitSayAndJson
  │    → { say, parsed, status }。status=ok|recovered|reask|failed:JSON.parse 直接失败时先用
  │    repairLooseJson 容错修复(转义 reason 串内漏转义的 "、删尾随逗号)再 parse(recovered);
  │    仍失败则非流式 json_object 模式 reaskJsonObject 重问一次(reask);再失败才 failed。
  │    避免「模型其实给了 recommend,因一个未转义引号被静默当成 chat、不入队」。
  │    status=failed → index.js 标 intent=parse_error:不执行队列动作、回一句"没接住,再说一次?"、
  │    chat_turns 如实记 parse_error(不污染记忆),绝不静默吞。
  │
  5. normalizePlayItems(chat-guards.js) + repairFamiliarNew(align-batch.js)— 确定性对齐,不重试(零延迟)
  │    play[] 缺 title/artist/reason → 丢弃,不进播放解析;source_pool 缺失或非法 → 归一为 wildcard;
  │    跨方向的歌换成方向内候选(新→库内),换不到就丢弃(宁短勿偏,queue 可短);
  │    familiar/new 硬对齐在**非 verbatim** 时执行——含方向 turn(2026-06-17 起方向也尊重探索
  │    档位,用方向内候选拉「全新」)。verbatim(「直接放每日推荐」)整步跳过;
  │    pinnedFirst(「第一首放 X」)保护 play[0]、其余照常对齐
  │
  6. checkReasonHallucination(budget-enforcer.js)— 启发式,命中 evidence 外细节则遮蔽 reason
  │
  7. resolvePlayList(playback-coordinator.js)
  │    cloudsearch → pickBest(只原唱)→ song/url(exhigh 320k);无 URL 则丢弃
  │
  8. arrangeQueue + applyChatRecommendation(queue-ops.js)更新 currentQueue / now —— 护栏:playable 为空时
  │    非 verbatim 默认打散;verbatim 保留 resolved playable 原顺序;pinnedFirst 保队首
  │    **不动 queue**(防止"解析空/全无版权 → 整列被清空、now=null、播放中断"),回一句系统提示。
  │    recordQueue + recordChatTurn(异步 RAG 索引本轮)
  9. broadcast: queue / now / dj_stream_end
```

**中止本轮(stop)**:ChatInput 在 DJ 工作期间(`busy = thinking || streaming`)把发送钮换成停止钮 → POST /api/chat/stop
→ index.js 对本轮 `AbortController.abort()`(单用户 `currentChat`,至多一轮在飞;signal 经 callLlmStream 透到 DeepSeek fetch)→ fetch 抛 AbortError →
catch 里识别 `ac.signal.aborted`:**不提交任何队列/反馈/记忆**(本轮等于没发生),只 broadcast `thinking=false`
+ `dj_stream_end{stopped:true}` 收尾已吐出的半句气泡。前端乐观收起 thinking,气泡尾部标 "— stopped"。

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
- **verbatim 例外**:`detectVerbatim(message)`(「直接/原样/按顺序 放每日推荐」)置 `meta.verbatim`,跳过比例换槽,并在最终 `arrangeQueue` 层保留 resolved playable 原顺序——显式摆放指令下 Agency 让位于"照办"。仍服从方向硬约束与 anti/cooldown;不可播歌曲可被丢弃,幸存歌曲不洗牌。
- **pinnedFirst(与 verbatim 不同)**:`detectPinnedFirst(message)`(「第一首放/听 X」)置 `meta.pinnedFirst`,保护 `play[0]`(点名的那首保持队首),其余歌**仍服从档位比例换槽**(这是与 verbatim 的关键区别:verbatim 跳过换槽并保序,pinnedFirst 不跳过)。若 `play[0]` 无法解析出可播 URL,先重试一次解析路径,仍失败才向用户发系统提示而非静默丢弃。chat 队列整体打散(`arrangeQueue`),pinnedFirst 时只保住队首。

### 3.2 方向硬约束(优先级高于档位)— `server/direction.js`

用户点名**语种 / 性别 / 艺人**(如"国语女声"、"英文男声"、"放点孙燕姿")即为**硬约束**,本批每首都必须落在方向内;档位只决定方向内的「熟悉↔全新」配比。

- **检测**:语种关键词(国语/中文/英文/韩语/日语…)+ 性别关键词(女声/男声)+ 点名艺人(匹配曲库艺人名)。
- **语种判定 = `trackLang(title, artist)`:艺人语种表优先,歌名脚本兜底**(2026-06-13)。`direction.js` 内置 `ARTIST_LANG`(Elliot 真实曲库 + 反馈里的韩/日艺人:TWICE / IVE / BIGBANG / LE SSERAFIM / 米津玄師 / ONE OK ROCK…),命中即定语种,**无视拉丁标题**;查不到才退回 `songLang(title)`(歌名脚本,title-primary)。
  - **为何**:纯歌名脚本对 K-pop/J-pop 会塌——绝大多数歌名是拉丁字母("Talk that Talk"/TWICE、"Lemon"/米津玄師),被判 english,导致"韩语/日语"方向把它们全过滤掉,候选池缩到只剩歌名带谚文/假名的极少数。**实测坑:点「KPOP女声」整池只剩 1 首(바빠/SISTAR),其余全是被误杀的拉丁标题 K-pop。**修复后同请求库内候选 2→10。
  - **兜底仍保护**:未知艺人走 `songLang`,latin 标题 → english,**即使艺人含中文**——"Sad Sometimes"(黄霄雲 EDM)仍排除出"国语"。`ARTIST_LANG` 只收**确定是韩/日**的艺人,不放中/英艺人,以免污染其它方向。新增韩/日艺人往该表加(key 用 `norm()` 形式)。
- **会话延续**:`currentDirection` 存在 index.js,由 `resolveDirectionState` 统一演进。纯续批/纠错("下一批/继续/我说了/不要给…")里的 partial direction 才与上一轮做 `base ∩ new`:KPOP + "只要女声" => 韩语女声;国语女声 + "我说了中文" => 国语女声;KPOP 女声 + "我要听KPOP啊"仍保留女声。新的明确语种/艺人请求按 fresh direction 处理,未重说的硬维度直接清空:华语男声+陶喆/李荣浩/林俊杰 后说"来一批华语流行" => 仅中文/国语;说"来一批英文流行" => 仅英文;说"来一批林俊杰" => 仅艺人林俊杰。明确"随便/都行/放开"清空;明确"不限男女/男女都行"只清性别维度。
- **取数**:RAG 用方向词检索(而非空查询"下一批");库内从**全量收藏按方向随机采样**(每次不同 → 缓解"老推同几首");recommend / explore 池都按方向过滤;explore 种子取方向内收藏曲(→ simi 近邻 + 同艺人深挖天然在方向内)。
- **宁短勿偏**(2026-06,取代早期"比例让位"):跑偏方向的歌优先换成方向内候选(新→库内),候选枯竭则**直接丢弃**——queue 可以短,**绝不用跨方向歌凑满,绝不谎报语种**。方向 turn **仍服从档位 familiar/new 换槽**(2026-06-17:取消了"方向 turn 不再硬对齐"例外,统一走 `repairFamiliarNew`)。chat 推荐队列落盘前经 `arrangeQueue` 打散(避免「前面全是听过的」),pinnedFirst 时只保住队首。
- **server 保证语种 + 保守性别硬校验**:语种用 `ARTIST_LANG` + 歌名脚本;性别用小型 `ARTIST_GENDER` 确定表。已知男团/男声(CNBLUE / BIGBANG / 王杰 / 陈奕迅等)不会满足女声方向;已知女团/女声(TWICE / IVE / 田馥甄 / 孙燕姿等)不会满足男声方向。未知或混合合作曲不硬拒绝,交给 LLM 终筛,避免误杀。
- 详见 memory: `project_direction_hard_constraint.md`。

### 3.3 三个候选池 + agency 层

| source_pool | 来源 | 说明 |
|---|---|---|
| `library` | RAG 曲库召回 / 方向采样 | 你收藏的歌(网易云快照 + Apple Music MD)。 |
| `recommend` | 网易云每日 daily + 2×personal_fm | 去重、30min 缓存、每轮 shuffle 取 20。方向激活时按方向过滤。 |
| `wildcard` | `discovery.js`(→ `explore-pool.js` + far tier) | **near tier**(simi 近邻 + 同艺人深挖,原 explore-pool 逻辑)+ **far tier**(direction 激活时走 playlist-search / open 时走 similar-artists / 大众榜兜底),affinity 加权重排,limit 24;结果按 focusKey(方向+档位)缓存 30min。`context-builder` 替换原 `buildExplorePool` 直调,缓存未过期时零网络。 |

**Agency 原则**(memory: `feedback_agent_agency_recs`):网易云 `/simi/song` 只作**候选生成**,agent 自己去重/过滤/打散/重排,**绝不照搬外部排序**。explore 排除集 = 已收藏 + anti + cooldown + 最近播放 + **wrong_vibe(负反馈)**。

### 3.4 反馈飞轮(love 持久累积 · 负反馈即时;2026-06-15 重构为 affinity 学习层)

- **4 键反馈**(写 `feedback` 表 + 异步 RAG 索引):

  | 键 | signal | 后端 |
  |---|---|---|
  | ❤️ 喜欢 | `love` | 记录(带 ncm_id)+ RAG 索引 + `affinity.js` 累积亲和度(持久,不衰减;多次 love 加深权重) |
  | 💢 不对味 | `wrong_vibe` | 记录;从 explore 排除 |
  | 🔁 太熟了 | `too_familiar` | 进 `cooldown` 90 天 |
  | 🚫 别再播 | `never_again` | 进 `anti_list` 永久禁播 |

- **负反馈处理(2026-06-15 更新)**:
  - **wrong_vibe**:从 explore 排除 + prompt「不喜欢」avoid-list(明确不喜欢,别再推)。
  - skip 不再降权:skip 是正常浏览行为,不作为降权信号(已移除 `skipStats` / `staleLoves`)。
  - love 不再衰减:移除 >90 天 ⚠旧爱标注;love 视为持久口味(用户自己 wrong_vibe 来修正)。
- **affinity 学习层(`server/affinity.js`,2026-06-15)**:从 `feedback` 表**在线派生**「歌/艺人」累积亲和度(无独立存储),喂给**两条路径**:
  - **Listen(venture/wild)**:`songWeight` 加权选曲;`graduatedLibrary` 把没在库的 loved 歌并入库内池(loved 发现「毕业」进轮换,不再评论完就蒸发);explore 种子用 `lovedSeeds` 而非随机库歌;`negativeSongs` 排除 wrong_vibe + cooldown。
  - **chat**:librarySlice 按亲和度排序;no-direction explore 种子优先 `lovedSeeds`;prompt 注入 `liveTasteBlock`(近期 love 艺人/歌,优先于静态 taste.md)。
  - 新 love **即时**影响下一次推荐(派生即读)。legacy 一次性补 id:`scripts/backfill-feedback-ncmid.js`。
- **信号源**:PWA 自身 `<audio>` 事件——`/api/play-event`(`natural`)、`/api/skip`(`user_skip`)。**没有 MediaRemote**(那是 macOS 方案,留待迁 Mac)。

---

## 四、LLM 契约

- **prompt 拆分**(RAG 后,触发 DeepSeek prefix cache):
  - `prompts/system.md`(~3KB,跨 session 不变):DJ 人格 + 推歌强约束(reason 锚 evidence / 方向硬约束 / 不重复 RECENT_PLAYS / 避讳词 / 诚实 reason 不编个人史…)+ 输出 schema。
  - `prompts/user-turn.md`(每轮变):用户消息 + now-playing + queue + **方向块** + **探索档位 + 本批 familiar/new 目标** + RAG 召回(库内/recommend/explore/反馈/taste/life-stage/mood/vibe/语义历史)+ anti/cooldown/**降权**/RECENT_PLAYS。
  - 多轮 `messages[]`:最近 5 轮 chat_turns 回放成 user/assistant 对(近因)。
- **prose-then-JSON**:第一步纯文本 = `say`(逐字流式);第二步 ```json``` 块 = `{intent, play[], queueAction, feedback_extract, modeUpdate}`,**不含 say**。
  - **开场白只说氛围/方向,不点具体歌名/艺人名/精确数量/最终顺序承诺**:`say` 先于 JSON 流出,而 `repairFamiliarNew` / 字段校验 / 版权解析 / `arrangeQueue` 可能换歌、丢歌、保序或打散——点名和数数都会和真实队列对不上(prompt 约束;每首"为什么"放 per-song `reason`,播放时逐首显示)。
  - `intent` ∈ `recommend` / `chat` / `feedback`(+ server 端 `parse_error`)。**server 端兜底**:整句确认词("好的"/"嗯")→ LLM 前置短路为 `chat`(`isAcknowledgment`,绝不重新推荐、不记录 queueAction、不清 direction);`status=failed` → `parse_error`(不入队、不污染 chat_turns 记忆)。
  - `play[]` 每首:`title, artist, reason, memoryLink, confidence, source_preference, source_pool`。其中 `title/artist/reason` 为 server 入队必填;缺失的条目由 `normalizePlayItems` 丢弃,不会进入播放解析。`source_pool` 应输出 `library|recommend|wildcard`,但缺失或非法时 server 会归一为 `wildcard`,避免因辅助标签缺失把可播队列整批丢掉。
  - `feedback_extract`(intent=feedback 时):`{target_title, target_artist, target_category, signal, reason}`。
- **provider 路由**(`llm-adapter.js`,按 model 名前缀):`claude-*`→ claude CLI 子进程;`deepseek-*`→ DeepSeek HTTP;`qwen-*`→ DashScope HTTP。**流式仅 deepseek/qwen**(SSE);claude 无流式 → 整段拿回再一次性 emit。
- **每次调用全量落盘** `data/llm-calls.jsonl`:`{ts, model, trigger, prompt(JSON.stringify{system,messages}), response, duration_ms, error}`。这是 prompt 调试的关键资产。

---

## 五、播放解析(`playback-coordinator.js` · `resolvePlayList`)

模型只给 `title/artist`,server 解析成可播直链:

1. `cloudsearch("title artist", limit 5)`。
2. `pickBest`:**只取原唱**——默认滤掉变体(remix/cover/live/伴奏/纯音乐…);先「歌名+艺人精确」匹配,再「剥后缀名+艺人」匹配;找不到原唱则**丢弃**(`[playback] no original version found`)。用户主动要变体(标题自带 remix/live)时才放行变体。
3. `song/url/v1`(`level=exhigh` 320k)。无 URL → 丢弃(`found=false`),不进 queue。**账号是 VIP(`vipType:11`)**,所以 VIP 专享(`fee:1`)的歌能正常取到直链,**不是**掉队原因;真正取不到的是:下架(`code:404`,如周杰伦整库被网易云下架)、区域限制、或 `pickBest` 滤掉变体后只剩翻唱。
4. 并行解析,顺序与 `play[]` 对齐。

**已知取舍**:下架 / 区域限制 / 仅有翻唱的歌会掉队。这是当前已知、未优先处理的缺口。

**按 id 取直链(`resolveById`,SEARCH 结果点播 / Listen 歌单用)**:前端/引擎带确定的 `ncm_id` → 跳过搜索,直接 `song/url/v1` 取直链 + `song/detail` 补封面/时长。无直链(VIP/无版权)→ `reason:'unplayable'`;瞬时网络 / NCM 5xx → `reason:'error'`(前端文案区分"放弃"和"重试")。没带 `ncm_id` 时降级走 `resolvePlayList`。

**直链时效与按需重解析**:`song/url/v1` 返回的直链是 **token 时效,约 20min 失效**(响应里 `expi:1200` 秒)。而一次 chat/推荐是整批解析、缓存进内存 `currentQueue`,`skip`/`play-event` 推进队列与刷新重连都**只发缓存**、不重解析 —— 队列里等久了或刷新后的歌,直链早过期,表现为「播到一半卡死(像断网)」「刷新后封面在、点播放/下一首没反应」。修法是**播放层按需重解析**,不在 advance 时预解析(免得每次切歌都加一次网络往返):

- 服务端 `POST /api/resolve { ncm_id, title, artist }` → 复用 `resolveById` 取新鲜直链,回 `{ found, url?, reason? }`。
- 前端 `<audio>` `@error`(直链 403/失效最常见)→ 调 `/api/resolve` 换新链续播,**尽量从中断位置恢复**;**每首至多重解析一次**(避免对真·慢 CDN 反复重启缓冲)。结果分流:`found` → 无感续播;`unplayable` → 提示并 `skip`;`error`(网络/NCM 瞬时)→ **只提示不跳**(否则 NCM 一挂整列会被连环跳光,让用户手动重试)。
- 另有长卡顿看门狗:`waiting/stalled` 且零进度超 15s(过期常表现为挂死而非 error)→ 同样重解析一次。

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

**测试隔离**:`state-db.js` 的 `DB_PATH` 在检测到 `NODE_TEST_CONTEXT`(即 `node --test` 子进程)时改开 `:memory:`,所以单测里的 `DELETE FROM embeddings; DELETE FROM vec_embeddings;` 打不到生产库。`NIGHTLINER_DB` 环境变量可显式覆写路径。(历史 bug:旧代码硬编码 `data/state.db`,每次 `npm test` 都会清空生产 RAG 索引。)

`data/` 其它(均 gitignore):`netease-snapshot.json`(收藏快照)、`apple-music-favorites-2024-2026.md`(收藏)、`tuning.json`(调音台持久化)、`llm-calls.jsonl`(调用日志)、`netease-cookie.txt`(**凭证,勿入库**)。

**内存态**(`index.js`):`currentQueue` / `now` / `playHistory` / **`currentDirection`** / `tuning` / `recommendCache`。

---

## 七、HTTP / WS 契约(现状)

```
POST /api/chat               用户输入(异步,结果走 WS 流)
POST /api/chat/stop          手动中止正在生成的本轮 DJ 回复(中断 LLM 流,不提交队列/反馈/记忆)
GET  /api/now                当前 now-playing
GET  /api/queue              当前 queue
GET  /api/tuning             读调音台
POST /api/tuning             写调音台(exploration_pct / queue_length)→ 持久化 + 广播
POST /api/feedback           4 键反馈(title, artist, signal, reason?)
POST /api/play-event         播放结束事件(ended_reason=natural 时自动进下一首)
POST /api/skip               显式跳过(记 user_skip)
POST /api/skip-to            跳到 queue 内指定歌
POST /api/queue/clear        清空待播队列(正在播的歌保留为唯一一项,播完走"queue 结束")
POST /api/queue/remove       从待播队列移除指定歌 {ncm_id?, title, artist}(正在播的不可移除 → 409)
POST /api/previous           回上一首(playHistory)
GET  /api/recommend          今日每日推荐(推荐池 daily 切片,带 ncm_id/pic_url;空了退回整池)
GET  /api/search             ?q=&type=song|artist —— 歌曲(cloudsearch type=1)/ 歌手(type=100)
GET  /api/artist/songs       ?id= —— 歌手热门曲(/artist/top/song)
POST /api/play               手动点播 {title, artist, ncm_id?, mode:'now'|'queue'}
POST /api/listen             点即播歌单 {level: daily|comfort|cozy|balanced|venture|wild} → 生成整批替换 queue 并从首歌开播
                             (5档) 库池合并 graduatedLibrary(loved discoveries not yet in library)；以 lovedSeeds 代替随机库歌做探索种子(cold-start fallback 随机)；excludeKeys 追加 negativeSongs(wrong_vibe + cooldown)；buildPlaylist 传入 weightOf=songWeight 按 affinity 加权排序。
GET  /api/state/anti         anti-list
GET  /api/state/cooldown     active cooldowns
GET  /api/state/history      最近 10 轮 chat_turns
GET  /api/state/stats        反馈/事件计数
WS   (同端口)                广播
```

WS 广播 `type`:`now` / `queue` / `tuning` / `thinking` / `dj_stream_start` / `dj_stream_delta` / `dj_stream_end` / `dj_message` / `stats`。

**手动点播语义**(SEARCH 整版页结果 → `POST /api/play`):`mode:'now'` 把歌插到当前 now 之后并切过去——DJ 队列原样保留,这首播完顺着原队列走;`mode:'queue'` 追加队尾、不动 now(now 为空则直接开播)。队列变更是纯函数(`queue-ops.js`),`recordQueue({mode:'manual'})` 记档。**不校验 anti/cooldown**——用户明确点名就尊重,这些约束只作用于 DJ 出歌的 prompt。play-event 仍由前端 `<audio>` 照常上报,口味学习不断档。

**Listen 歌单语义**(Listen 页 → `POST /api/listen`):`daily` = 每日推荐池 daily 切片随机取 N;5 档(comfort/cozy/balanced/venture/wild)= `playlist-builder.buildPlaylist` 按档位 `lib/rec/wild` 配方,从「收藏快照 / recommend / explore-pool」三池**确定性随机抽样**(不调 LLM,秒级),去重 + 排除 anti-list/最近播放 + 不足回填到 N;`resolveById` 并行解析后**整批替换 queue、从首歌开播**。点歌单**不改全局调音台 `exploration_pct`**(一次性「来一发这个能量级」)。排除 anti-list,但与手动点播一致**不校验 cooldown**。

---

## 八、前端(PWA · 单页 Player)

| 组件 | 职责 |
|---|---|
| `App.vue` | WS 连接 + 状态根 + 事件分发(onFeedback/onSkip/…) |
| `HeroCard.vue` | 封面 / 歌名 / 进度 / `<audio>` 控制（**播放/暂停图标完全由 `<audio>` 的 play/pause 事件回写,不手动翻转——刷新后被拦截的 autoplay / OS 媒体键都能正确同步;空格键 = 暂停/播放,文本框内不拦截**)/ **音量持久化(localStorage `nl_volume`,默认 33)** / ❤ 常驻 + hover 出 × 反馈面板 / **队列入口(list 图标 → QueueDrawer)** |
| `TuningDrawer.vue` | **调音台**:探索档位(5 档吸附滑块,显示英文名)/ Queue 长度 |
| `QueueDrawer.vue` | queue 预览 + CLEAR 清空待播(只在有待播歌时显示);每行 hover 出 × 单独移除待播歌,正在播的那首不可删 |
| `ChatInput.vue` | 底部常驻输入 + **搜索入口(左侧放大镜 → 把输入框已打的字直接带进搜索整页并搜出;空则开空搜索)** + **DJ 工作期间发送钮变停止钮(`@stop` → POST /api/chat/stop)** |
| `DJLog.vue` | DJ 流式气泡(逐字)+ 系统消息;**被中止的半句标 "— stopped"** |
| `AppHeader.vue` | masthead:wordmark + ON AIR(播放时)+ **▦ Listen 入口** + **TUNING**(2026-06:搜索移入输入栏、队列移入播放栏,刊头只剩这两个;窄屏 ON AIR 退化为呼吸金点) |
| `ListenPage.vue` | **Listen 整页**:6 张「点即播」卡(Today's Picks + Comfort/Cozy/Balanced/Venture/Wild)→ `POST /api/listen` 生成开播;Esc/✕ 关闭 |
| `PlaylistCard.vue` | **统一标牌封面**:墨底 + 衬线英文标题 + 金色标记(只英文标题、无描述);`kind=level` = 金色刻度(填充 = 探索度,Comfort→Wild 淡暖递增)/ `kind=daily` = 整宽金线 + 日期 |
| `DiscoverPage.vue` | **搜索整页**(输入栏放大镜打开,`variant=search`):SONGS/ARTISTS 切换,歌手下钻热门曲;点行即播、⊕ 排队;Esc/✕ 关闭。(`variant=daily` 为 legacy,仅 `/daily` 命令可达,已被 ListenPage 取代) |
| `SongCard.vue` / `SongRow.vue` / `ArtistRow.vue` | 搜索/每日封面卡 / 结果行 / 歌手行(playing 金色高亮) |
| `ThinkingIndicator` | 思考中 |
| `Icon.vue` | 内联 lucide 线条图标(无运行时依赖);新增图标往 PATHS 加一条即可 |
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
  direction.js          方向检测/匹配/状态合并(resolveDirectionState, detectDirection, trackLang, songMatchesDirection)
  chat-guards.js        chat 输出入队前纯校验(normalizePlayItems:必填字段/source_pool 归一)
  exploration-modes.js  5 档命名模式表 + modeForValue + familiarTarget
  align-batch.js        repairFamiliarNew:方向感知 + familiar/new 硬对齐(确定性换槽)
  explore-pool.js       buildExplorePool:simi 近邻 + 同艺人深挖(agency 层,供 discovery.js 的 near tier 内调用)
  discovery.js          buildDiscoveryPool:near(explore-pool)+ far(playlist-search/similar-artists/charts)两层混合,affinity 重排,30min per-focusKey 缓存
  retriever.js          retrieveContext:多路 sqlite-vec 召回
  indexer.js            chunk + indexSong/Feedback/ChatTurn/MdFile + indexAll*
  embedder.js           BGE-M3(@huggingface/transformers ONNX q8)embed/embedBatch/warmup
  vec-store.js          searchSimilar({embedding, source_type, top_k})
  state-db.js           SQLite + sqlite-vec;play/feedback/queue/chatTurn + embeddings CRUD
  ncm-client.js         网易云封装(cloudsearch/searchArtists/songUrl/recommend/personalFm/simiSong/artistTopSongs/…)
  llm-adapter.js        callLlm / callLlmStream(SSE)/ splitSayAndJson / extractJson;多 provider 路由
  llm-logger.js         llm-calls.jsonl 落盘
  playback-coordinator.js  resolvePlayList(cloudsearch → pickBest 原唱 → songUrl)+ resolveById(手动点播按 id 直取)
  search-normalize.js   NCM 返回 → 前端统一形状(song/artist)纯函数
  playlist-builder.js   buildPlaylist:按档位配方从三池确定性随机抽样(Listen 点即播歌单)纯函数
  queue-ops.js          playNow/enqueue/clearUpcoming/removeFromQueue/arrangeQueue:currentQueue/now 纯变更 + chat 队列排序(verbatim 保序)
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
- **改负反馈行为**:`server/affinity.js`(`wrongVibeSongs` / `negativeKeys`)+ `server/context-builder.js`(接线)。

---

**文档结束。** 现状以代码为准;本文档与代码冲突时,改本文档。
