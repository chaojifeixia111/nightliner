# NightlinerFM 每日推荐 + 搜索 前端入口 设计文档

**日期**: 2026-05-30(2026-06-12 改版)
**作者**: Elliot + Claude
**状态**: ✅ 已实现(2026-06-12,DiscoverPage 搜索/每日整页)。**后续**:其 DAILY/SEARCH 刊头入口已被 2026-06-13 Listen 页方案取代——搜索移入输入栏(放大镜)、每日推荐并入 Listen 页;DiscoverPage 仅保留 `search` variant(`daily` variant 转 legacy,仅 `/daily` 命令可达)
**改版说明**: 2026-06-12 前端从「双右滑抽屉」改为「夜刊整版页」(配合 night-issue 重设计,见 memory: night-issue design system);后端设计不变
**关联**: 2026-05-28-rag-local-embedding-design.md

---

## 1. 背景与动机

目前 NightlinerFM 是纯「DJ 陪聊电台」:只能通过跟 DJ 对话来出歌。网易云每日推荐其实已经在服务端每轮拉取并注入 DJ 的 prompt(见 `prompts/system.md` 的「数据源」一节),但用户**没有一个直接的入口**去浏览今天的每日推荐,也**不能主动搜一首歌或一个歌手来听**。

本设计加一个「整版页」入口,让 app 在保留「DJ 电台」灵魂的同时,具备正经音乐 APP 的两个基本能力:

1. **每日推荐** — 点开就是今天网易云每日推荐的封面卡片网格,点卡即播。
2. **搜索** — 同一版面顶部的搜索栏,输入即搜;支持**歌曲**和**歌手**两种,搜歌手可下钻到热门曲。

设计隐喻:app 已重设计为「夜刊」杂志风,每日推荐就是字面意义上的「今日刊」——配整版版面,而不是塞进侧抽屉。搜索空态 = 推荐位,是用户熟悉的模式。

后端能力(`recommendSongs` / `cloudsearch` / `songUrl` / `resolvePlayList`)大部分已就绪,本期主要是**把它们暴露成接口 + 补歌手相关两个端点 + 做一个整版页**。

## 2. 设计目标

| 目标 | 指标 / 说明 |
|---|---|
| 入口一致性 | masthead 文字导航(`DAILY · SEARCH · QUEUE · TUNING`),不引入图标按钮或新导航范式 |
| 风格一致性 | 全部使用 night-issue token(ink/paper/gold)、`Icon.vue` lucide 线条图标、英文小字距 chrome 文案 |
| 直接操作 | 点封面卡 / 结果行 = 立即播放;行内/卡角 ⊕ = 加入队列末尾 |
| 搜索两态 | 歌曲 / 歌手 切换;歌手结果点进去看其热门曲,可返回 |
| 一页两用 | 搜索栏空 → 今日推荐卡片网格;输入 → 就地变结果;清空 → 回到推荐 |
| 不打断 DJ | 「立即播放」插到当前歌之后,DJ 现有队列原样保留、播完接着走 |
| 口味学习不断档 | 手动播放的歌照常由前端 audio 上报 play-event,沿用现有记录链路 |
| 复用播放解析 | 播放统一走 `playback-coordinator`(取原唱、跳翻唱/伴奏) |
| 失败有反馈 | 推荐空 / 搜索无结果 / VIP 无版权,都有明确的空状态或 toast(英文短句) |

**非目标(本期不做)**:
- 搜索**专辑 / 歌单**(本期搜索只做歌曲 + 歌手)
- 「刷新每日推荐」按钮(池子服务端 30 分钟自动刷新,够用)
- 每日推荐**歌单**(`/recommend/resource`,本期只做每日推荐**歌曲** `/recommend/songs`)
- 搜索历史、搜索联想
- 底部标签栏 / 右滑抽屉方案(2026-06-12 已否决,选整版页)

## 3. 整体架构

```
┌───────────────────────────── PWA (Vue 3) ─────────────────────────────┐
│  Masthead:  NightlinerFM        DAILY · SEARCH · QUEUE · TUNING        │
│                                   │       │                            │
│                       open-daily ─┘       └─ open-search(聚焦输入框)    │
│                                   ▼       ▼                            │
│   DiscoverPage.vue(整版覆盖层,同一组件)                                 │
│   ├ 顶部: 搜索栏(serif 输入 + 金色下划线) + 关闭 ✕                       │
│   ├ query 空 → "TODAY — THU · 12 JUN · 30 TRACKS"                      │
│   │            SongCard 网格(onOpen → GET /api/recommend)              │
│   └ query 非空 → SONGS | ARTISTS 切换                                   │
│        ├ SONGS:  GET /api/search?type=song   → SongRow 列表             │
│        └ ARTISTS: GET /api/search?type=artist → ArtistRow 列表          │
│                    → 点歌手 → GET /api/artist/songs?id= (下钻,可返回)   │
│   点卡/行 → POST /api/play {mode:'now'}                                 │
│   点 ⊕   → POST /api/play {mode:'queue'}                               │
└───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
┌──────────────────────────── Server (index.js) ────────────────────────┐
│  GET  /api/recommend             → getRecommendPool() [songs w/ id,pic]│
│  GET  /api/search?q=&type=song   → cloudsearch(type=1)   [songs]       │
│  GET  /api/search?q=&type=artist → cloudsearch(type=100) [artists]     │
│  GET  /api/artist/songs?id=      → artistTopSongs(id)    [songs]       │
│  POST /api/play                  → resolve → 改 now/queue → broadcast  │
│        ├ mode='now'   : 插到当前歌之后 + 设 now                         │
│        └ mode='queue' : 追加到 currentQueue 末尾                        │
│  播放解析: playback-coordinator (优先按 ncm_id 直取 songUrl)            │
└────────────────────────────────────────────────────────────────────────┘
        ws: {type:'now'} / {type:'queue'}  →  HeroCard <audio> 自动播放
```

## 4. 后端设计

### 4.1 每日推荐池保留 id + 封面

`server/index.js` 的 `getRecommendPool()` 当前把 `dailySongs` 压成 `{name, artist}`,丢掉了 `id` 和封面。改为保留:

```js
const songs = (data?.data?.dailySongs || []).map(s => ({
  name: s.name,
  artist: (s.ar || []).map(a => a.name).join(' / '),
  ncm_id: s.id,
  pic_url: s.al?.picUrl || null,
}));
```

`personalFm` fallback 同样补 `ncm_id` / `pic_url`。
**回归保障**:DJ prompt 渲染(`context-builder.js`)只取 `name`/`artist`,多出的字段不影响,无回归。

### 4.2 `GET /api/recommend`

```
→ 200 { songs: [{ name, artist, ncm_id, pic_url }] }
```
直接返回 `await getRecommendPool()`(已带 30 分钟缓存)。池子为空时返回 `{ songs: [] }`,由前端展示空状态。

### 4.3 `GET /api/search?q=&type=song|artist&limit=20`

- `q` 为空 → 直接返回 `{ songs: [] }` / `{ artists: [] }`(不打网易云)。
- `type=song`(默认):调 `cloudsearch(q, {limit})`(type=1),归一化 `result.songs`:
  ```
  → 200 { songs: [{ ncm_id, name, artist, pic_url }] }
  ```
- `type=artist`:调 `searchArtists(q, {limit})`(cloudsearch type=100),归一化 `result.artists`:
  ```
  → 200 { artists: [{ artist_id, name, pic_url }] }
  ```
  - `pic_url` = `picUrl || img1v1Url`

### 4.4 `GET /api/artist/songs?id=`

调 `artistTopSongs(id)` 取该歌手热门曲,归一化:
```
→ 200 { songs: [{ ncm_id, name, artist, pic_url }] }
```

### 4.5 `POST /api/play`

```
body: { title, artist, ncm_id?, mode: 'now' | 'queue' }
→ 200 { ok: true,  song: {...} }          // 成功
→ 200 { ok: false, reason: 'unplayable' } // 命中但 VIP/无直链
→ 200 { ok: false, reason: 'not_found' }  // 搜不到原唱
```

**解析**(新函数 `resolveById`,或复用 `resolvePlayList`):
- 有 `ncm_id`:直接 `songUrl(ncm_id, level)` 取直链 + `songDetail` 补封面 → 最快、最精确,避免二次搜索。
- 无 `ncm_id`(理论上不会发生,三个来源都带 id):降级走 `resolvePlayList([{title, artist}])`。
- 取不到直链(`data[0].url` 为空,fee=VIP / 无版权)→ 返回 `{ ok:false, reason:'unplayable' }`。

**状态变更**(复用 chat 流程里现成的 queue/now 逻辑 + `broadcast`,抽成纯函数便于单测):
- `mode='now'`:
  - 找到 `now` 在 `currentQueue` 的下标 `idx`;把解析好的歌 `splice(idx+1, 0, song)` 插进去,再 `now = song`。
  - `currentQueue` 为空时:`currentQueue = [song]; now = song`。
  - 关键:歌必须进 `currentQueue`,否则 `/api/play-event` 的 `findIndex(now)` 推进逻辑会断。
  - `broadcast({type:'now'})` + `broadcast({type:'queue'})`。
- `mode='queue'`:
  - `currentQueue.push(song)`;`broadcast({type:'queue'})`;不动 `now`。
  - 若此时 `now` 为空(没在放),等价于 now 播这首(`now = song` 并广播)。

**记录**:不在 `/api/play` 里额外记 play-event —— 歌成为 `now` 后由 `HeroCard` 的 `<audio>` 在播放/结束时照常 `POST /api/play-event`,沿用现有链路。`recordQueue({mode:'manual', songs:currentQueue})` 保持与 chat 一致。

**反屏蔽**:手动播放**不**校验 anti-list / cooldown —— 用户明确点了就尊重(这些约束本就只作用于 DJ 出歌的 prompt,解析链路天然不受影响,无需特殊代码)。

### 4.6 `server/ncm-client.js` 新增

```js
export async function searchArtists(keywords, { limit = 20 } = {}) {
  return ncmRequest('/cloudsearch', { keywords, limit, type: 100 });
}
export async function artistTopSongs(id) {
  return ncmRequest('/artist/top/song', { id });   // 返回 { songs: [...] }
}
```

## 5. 前端设计(night-issue)

### 5.1 `AppHeader.vue`(改)

masthead 导航在现有 `QUEUE` `TUNING` 左侧加两个文字链接,样式复用 `.nav-link`:

```html
<button class="nav-link" @click="$emit('open-daily')">DAILY</button>
<button class="nav-link" @click="$emit('open-search')">SEARCH</button>
<button class="nav-link" @click="$emit('open-queue')">QUEUE</button>
<button class="nav-link" @click="$emit('open-tuning')">TUNING</button>
```
`defineEmits(['open-tuning','open-queue','open-daily','open-search'])`。
两个新链接打开**同一个** `DiscoverPage`,区别只在 `open-search` 会聚焦搜索栏。

### 5.2 `App.vue`(改)

- 新增 `discoverOpen` / `discoverFocusSearch` ref;
- `@open-daily` → `discoverOpen=true, discoverFocusSearch=false`;`@open-search` → `discoverOpen=true, discoverFocusSearch=true`;
- 渲染 `<DiscoverPage :open="discoverOpen" :focus-search="discoverFocusSearch" :now="state.now" @close="discoverOpen=false" />`;
- 斜杠命令补 `/daily`、`/search`(与现有 `/queue` `/tuning` 一致)。

页面**自包含**地调接口(和 `QueueDrawer` 自己 POST `/api/skip-to` 一致),App.vue 不掺和播放逻辑。

### 5.3 `DiscoverPage.vue`(新,整版覆盖层)

- 覆盖层:`position: fixed; inset: 0; background: var(--ink-0); z-index: 300`,内部列与 `#app` 同宽(max-width 720px 居中)。上滑淡入过渡;✕ 或 Esc 关闭。
- **顶部一行**:搜索栏(lucide `search` 图标 + serif `<input>` + 有内容时显示清空 ✕)+ 右侧关闭 ✕。搜索栏底边 `--rule` 色,聚焦/有内容时变 `--gold`。
- **query 为空(默认态 = 今日刊)**:
  - 小字距栏目标签:`TODAY — {DOW} · {DD MMM} · {N} TRACKS`(sans 10px letterspacing 2px paper-3)。
  - `SongCard` 网格:`repeat(auto-fill, minmax(140px, 1fr))`,gap 14px。
  - 数据:打开时 `GET /api/recommend`,组件内缓存(再开不重复拉,除非为空)。
  - 空态文案:`Couldn't fetch today's picks — check NetEase login.`
- **query 非空(搜索态)**:`watch([query, mode])` 防抖 300ms。
  - `SONGS | ARTISTS` 分段切换(sans 小字距 pill,active 金边金字),默认 SONGS。
  - SONGS:`GET /api/search?type=song&q=` → `SongRow` 列表。
  - ARTISTS:两级视图(组件内 `view` 状态机):
    - `view='artists'`:`GET /api/search?type=artist&q=` → `ArtistRow` 列表;点一行 → 记 `activeArtist`、转 `artist-songs`。
    - `view='artist-songs'`:`GET /api/artist/songs?id=` → 返回行(`‹ {歌手名} — TOP SONGS`,金色)+ `SongRow` 列表;点返回回 `artists`。
    - 改 query / 切 mode → 重置回 `artists`。
  - 无结果文案:`Nothing found for "{q}".`;歌手无热门曲:`No playable tracks for this artist.`
- **toast**(页内顶部,2.5s 自动消失):
  - 点播失败 unplayable → `Can't play this one — VIP or region-locked.`
  - not_found → `Couldn't find a playable original.`
  - ⊕ 成功 → `Queued — {name}`
- 播放后页面**保持打开**(可继续挑)。

### 5.4 `SongCard.vue`(新,封面卡)

```
props: { song, isNow }       // song: { name, artist, pic_url, ncm_id }
emits: ['play', 'queue']     // 点卡 → play;角上 ⊕ → queue(@click.stop)
```
布局:方形封面(aspect-ratio 1,圆角 6px,`--ink-2` 细边;无封面用 `disc` 图标占位)+ 下方 serif 歌名(13px,省略号)+ sans 歌手(11px,paper-4)。封面右上角常驻小 ⊕(22px 圆钮,半透明墨底)。`isNow`:封面金边、歌名金字、歌手后缀 `· playing`。hover:封面边线变 `--rule`。

### 5.5 `SongRow.vue`(新,结果行)

```
props: { song, isNow }
emits: ['play', 'queue']
```
布局:serif 歌名(13px,flex:1,省略号)+ sans 歌手(11px,paper-4,右对齐)+ ⊕(borderless ghost,paper-3,hover paper-0)。行 hover `rgba(194,163,107,0.07)`;`isNow` 左边 2px 金线 + 金字(同 `QueueDrawer.current`)。

### 5.6 `ArtistRow.vue`(新,歌手行)

```
props: { artist }            // { artist_id, name, pic_url }
emits: ['open']
```
布局:30px 圆头像(无图用 ink-2 圆底)+ serif 歌手名 + 右侧 `chevron-right`(paper-4)。hover 同 SongRow。

### 5.7 `Icon.vue`(改)

PATHS 增补 4 个 lucide 路径:`search`、`plus`、`chevron-left`、`chevron-right`。

### 5.8 `ws-client.js`(改)

```js
export function playSong(song, mode) {   // mode: 'now' | 'queue'
  return fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: song.name, artist: song.artist, ncm_id: song.ncm_id, mode }),
  }).then(r => r.json());
}
```

## 6. 数据流(时序)

**点封面卡 / 结果行(立即播放)**
```
点 SongCard/SongRow → POST /api/play {ncm_id,title,artist,mode:'now'}
  → server: songUrl(ncm_id) → 插队列 idx+1 + 设 now
  → ws broadcast now + queue
  → App.vue 收到 → state.now 更新 → HeroCard <audio src=now.url> autoplay
  → 歌放完 → HeroCard POST /api/play-event → 推进到原队列下一首
```

**搜歌手 → 下钻 → 播**
```
ARTISTS 态输入 → GET /api/search?type=artist → ArtistRow 列表
  → 点歌手 → GET /api/artist/songs?id= → SongRow 列表
  → 点某首 → POST /api/play(同上)
```

**点 ⊕(加队列)**
```
点 ⊕ → POST /api/play {...,mode:'queue'}
  → server: 解析 + push 队尾 → ws broadcast queue
  → 队列更新;now 不变,当前歌继续放
```

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 每日推荐池空(cookie 过期 / NCM 没开) | `/api/recommend` 返回 `{songs:[]}`;页内空态文案 |
| 搜索无结果(歌曲/歌手) | `{songs:[]}` / `{artists:[]}`;`Nothing found for "{q}".` |
| 歌手无热门曲 | `/api/artist/songs` 返回 `{songs:[]}`;空态 |
| 歌曲 VIP / 无版权 / 无直链 | `/api/play` 返回 `ok:false, reason:'unplayable'`;toast |
| 搜不到原唱(只有翻唱) | `pickBest` 返回 null → `not_found`;toast |
| 网络 / 后端挂 | fetch catch → 页内通用错误条 |

## 8. 测试策略

- **后端纯逻辑(node --test)**:
  - search 结果归一化映射:歌曲(`result.songs` → `{ncm_id,name,artist,pic_url}`)、歌手(`result.artists` → `{artist_id,name,pic_url}`)、歌手热门曲。
  - `/api/play` 队列变更逻辑:`mode='now'` 插在当前歌之后并设 now;`mode='queue'` 追加末尾;空队列分支。把队列变更抽成纯函数便于单测。
- **集成 / 手动**(联网,依赖 NCM + cookie):对运行中的 server 实打 `/api/search`(两种 type)、`/api/artist/songs`、`/api/recommend`、`/api/play`,看返回与 ws 广播。
- **前端可视验证**(我的职责):整版页两态(今日刊卡片网格 / 搜索结果)、歌曲歌手切换、歌手下钻+返回、点卡即播、⊕ 排队、空态、toast、Esc 关闭,逐项截图核对,保证与 night-issue 版式一致。

## 9. 文件清单

**新增**
- `pwa/src/components/DiscoverPage.vue`
- `pwa/src/components/SongCard.vue`
- `pwa/src/components/SongRow.vue`
- `pwa/src/components/ArtistRow.vue`

**修改**
- `pwa/src/components/AppHeader.vue` — masthead 加 DAILY / SEARCH 文字链接 + emits
- `pwa/src/components/Icon.vue` — 增补 search / plus / chevron-left / chevron-right
- `pwa/src/App.vue` — discover 开关 state + 渲染 + 接线 + `/daily` `/search` 命令
- `pwa/src/ws-client.js` — `playSong` helper
- `server/index.js` — 4 个接口 + `getRecommendPool` 保留 id/封面 + 队列变更纯函数
- `server/ncm-client.js` — 新增 `searchArtists` / `artistTopSongs`
- `nightliner-design-v0.5.md` — 补「手动点播入口」小节(播放行为变化,维护纪律要求)

## 10. 未来扩展(不在本期)

- 「交给 DJ」二级动作(长按卡片 → DJ 接话编排)
- 搜索专辑 / 歌单 + 每日推荐歌单(`/recommend/resource`)
- 每日推荐「刷新」与「换一批」
- 搜索历史
