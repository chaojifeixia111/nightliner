# NightlinerFM 每日推荐 + 搜索 前端入口 设计文档

**日期**: 2026-05-30
**作者**: Elliot + Claude
**状态**: Draft, 待 review;截至 2026-06-12 **未实现**(对应 plan 的 task 均未开始)
**关联**: 2026-05-28-rag-local-embedding-design.md

---

## 1. 背景与动机

目前 NightlinerFM 是纯「DJ 陪聊电台」:只能通过跟 DJ 对话来出歌。网易云每日推荐其实已经在服务端每轮拉取并注入 DJ 的 prompt(见 `prompts/system.md` 的「数据源」一节),但用户**没有一个直接的入口**去浏览今天的每日推荐,也**不能主动搜一首歌或一个歌手来听**。

本设计加两个轻量入口,让 app 在保留「DJ 电台」灵魂的同时,具备正经音乐 APP 的两个基本能力:

1. **每日推荐** — 点开就能看到今天网易云每日推荐的整列,点歌即播。
2. **搜索** — 输入即搜,支持**歌曲**和**歌手**两种;搜歌手可下钻到该歌手的热门曲,点歌即播。

后端能力(`recommendSongs` / `cloudsearch` / `songUrl` / `resolvePlayList`)大部分已就绪,本期主要是**把它们暴露成接口 + 补歌手相关两个端点 + 做两个前端抽屉**。

## 2. 设计目标

| 目标 | 指标 / 说明 |
|---|---|
| 入口一致性 | 复用现有右滑抽屉交互(`QueueDrawer`/`TuningDrawer`),不引入新导航范式 |
| 直接操作 | 整行点 = 立即播放;行内 ⊕ = 加入队列末尾 |
| 搜索两态 | 歌曲 / 歌手 切换;歌手结果点进去看其热门曲 |
| 不打断 DJ | 「立即播放」插到当前歌之后,DJ 现有队列原样保留、播完接着走 |
| 口味学习不断档 | 手动播放的歌照常由前端 audio 上报 play-event,沿用现有记录链路 |
| 复用播放解析 | 播放统一走 `playback-coordinator`(取原唱、跳翻唱/伴奏) |
| 失败有反馈 | 推荐空 / 搜索无结果 / VIP 无版权,都有明确的空状态或 toast |

**非目标(本期不做)**:
- 搜索**专辑 / 歌单**(本期搜索只做歌曲 + 歌手)
- 「刷新每日推荐」按钮(池子服务端 30 分钟自动刷新,够用)
- 每日推荐**歌单**(`/recommend/resource`,本期只做每日推荐**歌曲** `/recommend/songs`)
- 搜索历史、搜索联想
- 底部标签栏 / 整页视图(已在 brainstorm 阶段否决,选 A·顶栏图标)

## 3. 整体架构

```
┌───────────────────────────── PWA (Vue 3) ─────────────────────────────┐
│  AppHeader:  NIGHTLINERFM            🔍  ♪  ☰  ⚙                        │
│                                       │   │                            │
│                         open-search ──┘   └── open-recommend           │
│                                       ▼   ▼                            │
│   SearchDrawer.vue  [歌曲│歌手]         RecommendDrawer.vue            │
│   ├ <input> 防抖 300ms                  ├ onOpen → GET /api/recommend   │
│   │   ├ 歌曲: GET /api/search?type=song                                 │
│   │   └ 歌手: GET /api/search?type=artist → 点歌手 →                    │
│   │            GET /api/artist/songs?id=  (下钻热门曲, 可返回)          │
│   └ 列表 ─┐  (SongRow / ArtistRow)      └ 列表 ─┐ (SongRow)            │
│           │  共用 SongRow.vue (封面+歌名+艺人+⊕)                         │
│           ▼                                     ▼                       │
│        整行点 → POST /api/play {mode:'now'}                             │
│        点 ⊕  → POST /api/play {mode:'queue'}                           │
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

**解析**(新函数 `resolveOneById`,或复用 `resolvePlayList`):
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

**记录**:不在 `/api/play` 里额外记 play-event —— 歌成为 `now` 后由 `HeroCard` 的 `<audio>` 在播放/结束时照常 `POST /api/play-event`,沿用现有链路。`mode='now'` 时可顺手 `recordQueue({mode:'manual', songs:currentQueue})` 保持与 chat 一致(可选)。

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

## 5. 前端设计

### 5.1 `AppHeader.vue`(改)

在现有 `☰ ⚙` 左侧加两个图标按钮,emit 新事件:

```html
<button class="icon-btn" title="搜索"   @click="$emit('open-search')">🔍</button>
<button class="icon-btn" title="每日推荐" @click="$emit('open-recommend')">♪</button>
<button class="icon-btn" title="队列"   @click="$emit('open-queue')">☰</button>
<button class="icon-btn" title="调音台" @click="$emit('open-tuning')">⚙</button>
```
`defineEmits(['open-tuning','open-queue','open-search','open-recommend'])`。

### 5.2 `App.vue`(改)

- 新增 `searchOpen` / `recommendOpen` ref;
- header 上接 `@open-search` / `@open-recommend`;
- 渲染 `<SearchDrawer>` / `<RecommendDrawer>`,各自收 `open` + `now`(用于「正在播」高亮,与 `QueueDrawer` 一致)prop + `@close`。

抽屉**自包含**地调接口(和 `QueueDrawer` 自己 POST `/api/skip-to` 一致),App.vue 不掺和播放逻辑,改动最小。

### 5.3 `SongRow.vue`(新,共用行)

```
props: { song, isNow }       // song: { name, artist, pic_url, ncm_id };isNow: 是否正在播
emits: ['play', 'queue']     // 整行点 → play;⊕ → queue(@click.stop)
```
布局:`[封面 30×30] 歌名/艺人(省略号) [⊕]`。样式抄 `QueueDrawer` 的 `.queue-row`(hover 蓝辉光、当前歌高亮)。`isNow` 时行内显示「▸ 正在播」并套用高亮样式。

### 5.4 `ArtistRow.vue`(新,歌手结果行)

```
props: { artist }            // { artist_id, name, pic_url }
emits: ['open']              // 整行点 → 下钻该歌手热门曲
```
布局:`[圆形头像 30×30] 歌手名 [›]`。样式与 `SongRow` 统一。

### 5.5 `RecommendDrawer.vue`(新)

- `watch(open)`:首次打开 `GET /api/recommend`,缓存在组件内(再开不重复拉,除非空)。
- 状态:loading / 列表 / 空(「今天的每日推荐没拉到 —— 检查网易云登录或稍后再试」)。
- 头部:`┌─ 每日推荐 · {n} ─┐` + ✕;副标题「网易云 · 每天更新」。
- 每行 `SongRow`,`@play` → `POST /api/play {mode:'now'}`,`@queue` → `{mode:'queue'}`。
- 播放后抽屉**保持打开**(可继续挑);⊕ 后给一个短暂视觉确认(行闪一下)。

### 5.6 `SearchDrawer.vue`(新)

- 头部:`┌─ 搜索 ─┐` + ✕;下方一个 **歌曲 | 歌手** 分段切换(segmented),默认「歌曲」。
- 一个 `<input>` 自动聚焦;`watch([query, mode])` 防抖 300ms。
- **歌曲模式**:`GET /api/search?type=song&q=` → `SongRow` 列表(点=播 / ⊕=排队)。
- **歌手模式**:两级视图,组件内部用一个 `view` 状态机:
  - `view='artists'`:`GET /api/search?type=artist&q=` → `ArtistRow` 列表;点一行 → 记 `activeArtist`、`view='artist-songs'`。
  - `view='artist-songs'`:`GET /api/artist/songs?id=` → 顶部一行「‹ 返回 · {歌手名}」+ `SongRow` 列表(点=播 / ⊕=排队);点返回 → `view='artists'`。
  - 切回「歌曲」模式或改 query → 重置回 `view='artists'`。
- 状态:未输入(提示)/ loading / 结果 / 无结果(「没找到 «q»」)。

### 5.7 失败 toast

`POST /api/play` 返回 `ok:false` 时,抽屉内顶部弹一条短提示(`unplayable` → 「这首拿不到,可能 VIP 或无版权」;`not_found` → 「没找到可播的原唱」),2.5s 自动消失。不阻塞继续操作。

## 6. 数据流(时序)

**整行点(立即播放)**
```
点 SongRow → POST /api/play {ncm_id,title,artist,mode:'now'}
  → server: songUrl(ncm_id) → 插队列 idx+1 + 设 now
  → ws broadcast now + queue
  → App.vue 收到 → state.now 更新 → HeroCard <audio src=now.url> autoplay
  → 歌放完 → HeroCard POST /api/play-event → 推进到原队列下一首
```

**搜歌手 → 下钻 → 播**
```
歌手模式输入 → GET /api/search?type=artist → ArtistRow 列表
  → 点歌手 → GET /api/artist/songs?id= → SongRow 列表
  → 点某首 → POST /api/play(同上)
```

**点 ⊕(加队列)**
```
点 ⊕ → POST /api/play {...,mode:'queue'}
  → server: 解析 + push 队尾 → ws broadcast queue
  → QueueDrawer/状态更新;now 不变,当前歌继续放
```

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 每日推荐池空(cookie 过期 / NCM 没开) | `/api/recommend` 返回 `{songs:[]}`;抽屉空状态文案 |
| 搜索无结果(歌曲/歌手) | `{songs:[]}` / `{artists:[]}`;抽屉「没找到 «q»」 |
| 歌手无热门曲 | `/api/artist/songs` 返回 `{songs:[]}`;空状态 |
| 歌曲 VIP / 无版权 / 无直链 | `/api/play` 返回 `ok:false, reason:'unplayable'`;toast |
| 搜不到原唱(只有翻唱) | `pickBest` 返回 null → `not_found`;toast |
| 网络 / 后端挂 | fetch catch → 抽屉内通用错误条 |

## 8. 测试策略

- **后端纯逻辑(node --test)**:
  - search 结果归一化映射:歌曲(`result.songs` → `{ncm_id,name,artist,pic_url}`)、歌手(`result.artists` → `{artist_id,name,pic_url}`)、歌手热门曲。
  - `/api/play` 队列变更逻辑:`mode='now'` 插在当前歌之后并设 now;`mode='queue'` 追加末尾;空队列分支。把队列变更抽成纯函数便于单测。
- **集成 / 手动**(联网,依赖 NCM + cookie):像本会话验证每日推荐那样,对运行中的 server 实打 `/api/search`(两种 type)、`/api/artist/songs`、`/api/recommend`、`/api/play`,看返回与 ws 广播。
- **前端可视验证**(我的职责):打开两个抽屉,点歌即播、⊕ 排队、歌曲/歌手切换、歌手下钻+返回、空状态、toast,逐项截图核对,保证与现有终端美学一致。

## 9. 文件清单

**新增**
- `pwa/src/components/RecommendDrawer.vue`
- `pwa/src/components/SearchDrawer.vue`
- `pwa/src/components/SongRow.vue`
- `pwa/src/components/ArtistRow.vue`

**修改**
- `pwa/src/components/AppHeader.vue` — 加 🔍 ♪ 两个图标 + emits
- `pwa/src/App.vue` — 抽屉开关 state + 渲染 + header 接线
- `server/index.js` — 4 个接口 + `getRecommendPool` 保留 id/封面 + 队列变更纯函数
- `server/ncm-client.js` — 新增 `searchArtists` / `artistTopSongs`;(可能)search 结果归一化小工具

## 10. 未来扩展(不在本期)

- 「交给 DJ」二级动作(长按一行 → DJ 接话编排)
- 搜索专辑 / 歌单 + 每日推荐歌单(`/recommend/resource`)
- 每日推荐「刷新」与「换一批」
- 搜索历史
