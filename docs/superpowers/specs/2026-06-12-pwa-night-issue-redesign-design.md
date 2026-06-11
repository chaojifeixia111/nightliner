# PWA 视觉重设计：夜刊（Night Issue）— 设计稿

日期：2026-06-12
状态：已与 Elliot 逐项确认（含两轮 mockup 修订），待最终过目后出实现计划
范围：纯视觉/文案层。不改 App.vue 的数据流、ws 协议、slash 命令功能、播放与缓冲逻辑、反馈上报逻辑。

## 1. 概念

放弃"终端拟物"（三种复古字体 + emoji 图标的小红书 CLI 风），换成**深夜刊物**的隐喻：DJ 说的话是正文，歌是插曲，封面是刊头图。界面像一页排好版的夜间杂志——hairline 细线 + 留白分隔，不再有"盒子套盒子"的卡片。

逐项确认过的方向决定：

- 暖夜固定色板 + 封面取色只做局部环境光（不全局取色）
- 封面：**居中圆角正方形**（不做出血横幅）
- 机器元素（slash 命令 / ON AIR / 状态栏）保留功能、重新着装
- 界面 chrome 文案**全英文**、正常语气；DJ 的 LLM 输出语风不在本次范围（归 `prompts/*.md`）

## 2. 色板（全部进 CSS 变量，根除散落硬编码）

```css
--ink-0:    #131110;   /* 页面底色（暖墨） */
--ink-1:    #1b1916;   /* 抬升面：抽屉、不喜欢面板 */
--ink-2:    #2c2823;   /* hairline 细线 / 轨道底色 */
--paper-0:  #f3ead9;   /* 歌名、播放键、最高亮 */
--paper-1:  #ded5c6;   /* DJ 正文 */
--paper-2:  #cabfae;   /* 图标默认、次级文字 */
--paper-3:  #9b9184;   /* 标签、艺人名、dim */
--paper-4:  #6e6357;   /* placeholder、时间码、最弱 */
--gold:     #c2a36b;   /* 签名色：ON AIR、进度、❤、发送、流式光标 */
--negative: #c1573f;   /* 负面语义：碎心 hover/激活、离线提示 */
--rule:     #5a5046;   /* 引文竖线 */
--ambient:  /* JS 动态：封面平均色，取色失败回退 --gold */
```

必须清除的旧值：`DJLog.vue` 的 `#5b9bd5` `#7fb8e0`，`HeroCard.vue` 的 `#d8506e`，及 index.html 全部蓝色系 token。点阵网格背景删除。

ambient 用途仅两处：封面正后方的 radial 微光（约 18% alpha）、换歌过场的色彩呼吸。实现：canvas 读封面平均色（`crossOrigin='anonymous'`）；网易云 CDN 不放行 CORS 时**静默回退鎏金**，不影响任何功能。

## 3. 字体（三个角色，中文全覆盖）

| 角色 | 字体 | 用途 |
|---|---|---|
| 主角 | Noto Serif SC（思源宋体）400/500 | 歌名、DJ 正文、用户引文、字标 |
| 标签 | 系统无衬线栈 + 大字距全大写 | DJ/YOU、ON AIR、日期线、QUEUE/TUNING |
| 数据 | JetBrains Mono 400 | 时间码、`/help` 类系统输出 |

- **退役：Press Start 2P、VT323**（无中文字形，是歌名落入宋体回退的根因）。
- Noto Serif SC 走 Google Fonts unicode-range 分片 + `display=swap`；离线回退栈 `'Noto Serif SC','Source Han Serif SC','STSong',serif`。
- 字号锚点：歌名 26px / DJ 正文 15px lh1.9 / 用户引文 14px italic / 标签 10px ls2px / 时间码 11px。

## 4. 图标（统一为 lucide 描边 SVG，currentColor，杀掉全部 emoji 与 Unicode 字符图标）

| 位置 | 现状 | 改为 |
|---|---|---|
| 上一首/播放/暂停/下一首 | ⏮ ▶ ⏸ ⏭ | skip-back / play / pause / skip-forward |
| 音量 | 🔊 🔇 | volume-2 / volume-x |
| 喜欢 | ♥ | heart（静止 `--gold`） |
| 不喜欢 | ×（Arial） | **heart-crack**（静止 `--paper-2`，hover/激活 `--negative`） |
| 不喜欢面板三选项 | × 🔁 🚫 | frown（Wrong vibe）/ repeat（Too familiar）/ ban（Never again） |
| 队列/调音入口 | ☰ ⚙ | 文字链接 QUEUE / TUNING |
| 发送 | 手写 SVG 箭头 | arrow-up（30px 鎏金描边圆） |

## 5. 版面（720px 单列不变，自上而下）

1. **刊头**：左 `NightlinerFM` 衬线字标（16px 500 ls1px）。右：ON AIR 印章 + QUEUE / TUNING 文字链接。~~"夜线电台"中文字样删除~~。
2. **日期线**：hairline 之间一条居中小字 `FRIDAY · 12 JUN 2026 · 04:22`（时钟活的，沿用 HeroCard 现有 timer）。
3. **离线提示**（替代被删除的 StatusBar）：仅断线时在日期线下淡入一行 `--negative` 色 mono 小字 `OFFLINE — backend not responding`；连接正常时无任何状态元素。
4. **Hero**：居中圆角正方形封面（260px，radius 14px，后方 ambient 微光）→ 居中衬线歌名 → 艺人行（10px ls2px 大写）→ memoryLink 变一行斜体小字（无前缀徽章、无边框）。无歌时封面位显示 `disc-3` 图标占位 + "Nothing playing — ask for something"。
5. **进度**：3px 圆角轨道，鎏金填充；下方左 = 已播、右 = 总时长；**点击右侧时间在 总时长 ↔ 剩余（−mm:ss）间切换**（默认总时长）。缓冲扫光动效保留，颜色改 gold 系。
6. **控制行**：`1fr auto 1fr` 网格，传输键**数学居中**（中键 22px，旁键 16px）。左栏：音量图标，hover 时 64px 滑条滑出（180ms，9px 纸色圆 thumb，拖动时填充转鎏金）。右栏：❤（常驻）+ 碎心（hover ❤ 浮现，交互沿用现状）。
7. **对话流（文字稿体例）**：标签 `DJ · 04:18` / `YOU · 04:20`（取代 `:NIGHTLINERFM` / `:USER`）。DJ = 衬线正文段落；用户 = 斜体 + 2px `--rule` 左竖线缩进；song 类消息歌名用 `--paper-0` 500；system 类 = mono 小字脚注体。打字机效果保留，流式光标改鎏金 `▍`。
8. **输入页脚**：hairline 上线，无 pill 盒子。placeholder 见 §6；发送 = 鎏金描边圆 arrow-up；busy 态 placeholder `DJ is on it…`。
9. **抽屉**（QUEUE / TUNING）：`--ink-1` 纸面板，标题大写大字距，行间 hairline。队列行：序号 mono dim / 歌名衬线 / 艺人 dim；当前行 2px 鎏金左线 + 鎏金歌名。调音标签：`EXPLORATION`（档位名已是英文）、`QUEUE LENGTH`。`┌─ QUEUE ─┐` 这类 ASCII 框线字符删除。
10. **ON AIR 印章**：1px 鎏金描边、9px ls2px。播放中 2.4s 呼吸闪烁；暂停或无歌时 300ms 淡出隐藏。
11. **不喜欢面板**：`--ink-1` 面板，英文文案——标题 `Not feeling it — why?`，选项 `Wrong vibe / Too familiar / Never again`，textarea placeholder `optional note`，按钮 `Cancel / Send`。

## 6. 文案（chrome 全英文、正常语气）

`greetings.js` 整库重写：保留分时段结构与 `pickGreeting()` API，全英文、短句、去抒情破折号体。基调示例（实现时每池 4–6 条）：

- morning：`Morning. What's first?` / `Something easy to start with?`
- afternoon：`What do you want to hear?` / `Need focus or a break?`
- evening：`Done for the day. What now?` / `Pick tonight's first track`
- night / late：`Still up? Name a song or a mood.` / `Something quiet?`

其他 chrome 文案：空队列 `Queue is empty — ask for something`；等待 `Picking the next one…`（ThinkingIndicator，衬线斜体 + 呼吸省略号）；发送失败 system 消息：`Send failed — is the backend running?`。

## 7. 动效

标准过渡 180ms ease；抽屉 250ms 滑入（沿用）；打字机 18ms/字符（沿用）；ON AIR 呼吸 2.4s；换歌时封面交叉淡入 + ambient 色过渡 600ms。无新增重动效。

## 8. 风险与回退

- **封面取色 CORS**：取不到 → 静默回退 `--gold`，零功能影响。
- **衬线字体离线**：Google Fonts 未缓存时回退系统衬线；后续可选本地内置字体文件（不在本次范围）。
- **行为不变式**：探索档位、方向约束、反馈信号语义均不受影响——本次只动皮肤与 chrome 文案，`nightliner-design-v0.5.md` 无需改动（其约束的是推荐/方向/播放行为）。

## 9. 涉及文件

`pwa/index.html`（token + 字体 + 背景）、`App.vue`（布局缝隙）、`AppHeader` `HeroCard` `DJLog` `ChatInput` `ThinkingIndicator` `QueueDrawer` `TuningDrawer`（着装）、`StatusBar.vue`（删除，离线提示并入 AppHeader 或 App）、`utils/greetings.js`（重写）、新增 `utils/ambient.js`（取色）与图标组件（lucide 内联 SVG，无运行时依赖）。
