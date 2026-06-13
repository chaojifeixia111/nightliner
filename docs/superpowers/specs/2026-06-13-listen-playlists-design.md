# NightlinerFM Listen 页 + 探索度歌单 设计文档

**日期**: 2026-06-13
**作者**: Elliot + Claude
**状态**: ✅ 已实现并验证(2026-06-13;`playlist-builder` 10 单测 + `/api/listen` 四档实测,前端 6 卡可视核对)
**关联**: 2026-05-30-recommend-search-frontend-design.md(本稿取代其 DAILY/SEARCH 刊头入口:搜索移入输入栏、每日推荐并入 Listen 页)

---

## 1. 背景与动机

现状是「跟 DJ 聊出歌」单一路径。但用户常常**不知道当下想听什么**,想要一条「点一下就开始放」的快路——按氛围/能量级直接进入,不必组织语言跟 DJ 对话。

本设计加一个 **Listen 页**:一墙 Apple Music 式封面卡,**点即播**。6 张:
- **Today's Picks**(每日推荐池,已有)
- **5 个探索度歌单**:Comfort / Cozy / Balanced / Venture / Wild(对应探索系数 0/25/50/75/100,配方复用 `exploration-modes.js`)

顺带把导航收拾干净(刊头四个文字链接太挤):搜索移入输入栏,队列移入播放栏,刊头只留 Listen 入口 + 调音台。

## 2. 设计目标 / 非目标

| 目标 | 说明 |
|---|---|
| 点即播 | 点任一卡 → 后端生成一批 → 直接替换队列开播(不进列表、不等 DJ) |
| 确定性随机 · 秒出 | 探索度歌单按档位配方从三池随机抽样,**不调 LLM**;延迟只在直链解析 |
| 不污染全局 | 点歌单**不改**调音台的 `exploration_pct`(一次性,不改 DJ 默认行为) |
| 复用引擎 | 配方复用 `exploration-modes.js`;池子复用 `getRecommendPool` / `explore-pool` / 收藏快照;解析复用 `resolveById` |
| 导航减负 | 刊头 = Listen ▦ + TUNING;搜索 → 输入栏放大镜;队列 → 播放栏 list 图标 |
| 风格一致 | night-issue token;探索度封面用「调音台刻度」母题,每日推荐用当天封面拼贴 |

**非目标**:歌单内 reason/DJ 解说(点即播是 jukebox,不是对话);自定义歌单;探索度歌单封面用真实拼贴(用设计母题即可);改动 DJ 聊天链路。

## 3. 后端

### 3.1 `server/playlist-builder.js`(新,纯函数,TDD)

```
buildPlaylist({ value, n=25, pools:{library,recommend,wildcard}, excludeKeys, rng }) → song[]
```
- `value` → `modeForValue` → 档位 `{lib,rec,wild}`。
- 目标数:`libN=round(lib%*n)`、`recN=round(rec%*n)`、`wildN=n-libN-recN`。
- 各池 shuffle 后取对应数量,跨池用 `plKey` 去重、跳过 `excludeKeys`。
- 某池不足 → 从所有池剩余回填到 n(宁可凑满也不返回半空)。
- 最终整体再 shuffle(避免「库内全在前」可预测段落)。纯函数,可注入 `rng`。
- `plKey(s)` = 归一化 `name|主artist`(大小写/空格无关)。

### 3.2 池子来源(endpoint 内构建)

| pool | 来源 | 备注 |
|---|---|---|
| library | 收藏快照 `data/netease-snapshot.json` 的 `{id,name,artists}` | 带 ncm_id → `resolveById` 直取;Apple-only(无 id)略过 |
| recommend | `getRecommendPool()` | daily+fm,已带 id/封面 |
| wildcard | `buildExplorePool({seeds})` | 种子 = 随机收藏曲 + 最近 love;simi 近邻 + 同艺人深挖 |

排除集 = `antiList`(永不重播)+ 最近播放(避免立即重复)。

### 3.3 `POST /api/listen`

```
body: { level: 'daily' | 'comfort' | 'cozy' | 'balanced' | 'venture' | 'wild', n? }
→ 生成 → resolveById 并行解析(丢 not-found)→ currentQueue=playable, now=[0]
→ recordQueue({mode:'listen'}) → broadcast queue+now
→ 200 { ok, count, level }
```
- `daily` 特例:直接用 recommend 池的 daily 切片(不走配方抽样)。
- 其余 5 档:`buildPlaylist({ value: 档位值, pools, excludeKeys })`。
- 与现有 `/api/play` 一样**不校验 cooldown**;但**排除 anti-list**(never_again 是永久禁播,即使手动也尊重)。

## 4. 前端(night-issue)

### 4.1 导航重构

- `AppHeader.vue`:`mast-actions` = ON AIR(播放时)+ **▦ Listen 图标** + **TUNING**;删除 DAILY/SEARCH/QUEUE 文字链接。
- 搜索:`ChatInput.vue` 输入框左侧加放大镜图标 → 打开搜索 overlay(复用现有 DiscoverPage `variant='search'`,只换触发点)。
- 队列:`HeroCard.vue` 控制行加 list 图标 → 打开 `QueueDrawer`(沿用)。
- `App.vue`:`listenOpen` 状态 + 渲染 `<ListenPage>`;`@open-listen` / `@open-search`(从 ChatInput)/ `@open-queue`(从 HeroCard)接线;`/listen` 斜杠命令。

### 4.2 `ListenPage.vue`(新,整页覆盖层)

- 覆盖层(同 DiscoverPage:`fixed inset-0`,ink 底,720 居中)。
- 头部:kicker `LISTEN NOW`(英文小字距)+ 关闭 ✕;Esc 关闭。
- 卡片网格:`repeat(auto-fill, minmax(150px, 1fr))`,gap 14px。
- 6 张 `PlaylistCard`,点 → `POST /api/listen {level}` → toast「Starting <name>…」→ 成功后页面保持打开(可换一张);失败 toast。

### 4.3 `PlaylistCard.vue`(新)

```
props: { card }   // { level, title, subtitle, kind:'daily'|'level', value?, covers? }
emits: ['play']
```
- `kind='daily'`:封面 = 2×2 当天歌曲封面拼贴(取 daily 池前 4 张 pic_url)。
- `kind='level'`:封面 = 「探索刻度」母题——ink 方块 + 大 serif 档名 + 金色刻度条(填充 = `value%`,knob 在末端)+ 左上 `EXPLORE · {value}` kicker。
- 卡下:serif 标题 + sans 副标题;封面右下角金边播放圆钮。

### 4.4 `Icon.vue`

增补 lucide `layout-grid`(Listen 入口)。

## 5. 错误处理

| 场景 | 处理 |
|---|---|
| 某档生成后全员解析失败 / 池子空 | `{ok:false}`;ListenPage toast「Couldn't build that playlist — try again.」 |
| 部分解析失败 | 丢弃 not-found,用剩下的开播(同 chat 链路) |
| 网络 / 后端挂 | fetch catch → 通用错误 toast |

## 6. 测试

- **后端纯逻辑(node --test)**:`buildPlaylist` 配方计数(Comfort 全 library、Wild lib1/rec8/wild16、Balanced lib13/rec9/wild3)、去重、excludeKeys、回填到 n、不超 n、纯函数不改入参、空池→[]。
- **集成 / 手动**:对运行中的 server 打 `POST /api/listen` 各档,看 queue 替换 + now 开播 + count。
- **前端可视**:Listen 页 6 卡渲染 + 封面母题 + 点即播 + toast;刊头只剩 ▦+TUNING;搜索从输入栏开;队列从播放栏开;Esc 关闭。

## 7. 文件清单

**新增**:`server/playlist-builder.js`、`tests/playlist-builder.test.js`、`pwa/src/components/ListenPage.vue`、`pwa/src/components/PlaylistCard.vue`
**修改**:`server/index.js`(/api/listen + 池子构建)、`pwa/src/components/Icon.vue`(grid)、`AppHeader.vue`、`ChatInput.vue`、`HeroCard.vue`、`App.vue`、`nightliner-design-v0.5.md`

> **协调**:`server/index.js` / `QueueDrawer.vue` / `queue-ops.js` / `v0.5.md` 当前有另一 session 的未提交 WIP(removeFromQueue 队列管理)。其提交前,本稿只动**新文件 + 当前 clean 的前端文件**(Icon/AppHeader/ChatInput/HeroCard/App/ListenPage/PlaylistCard);`/api/listen` 接线与 v0.5 同步**待其提交后**再做。

## 8. 未来扩展

- 自定义/收藏歌单卡;歌单封面用真实拼贴;Listen 页的「最近播过的歌单」行;点即播的首歌先出、其余后台续解析(更"秒")。
