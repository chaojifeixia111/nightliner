# PWA 夜刊视觉重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [设计稿](../specs/2026-06-12-pwa-night-issue-redesign-design.md) 把 PWA 从"终端拟物"换装成"夜刊"（暖墨色 + 思源宋体 + lucide 描边图标 + hairline 版面），纯视觉/文案层，不动数据流与播放逻辑。

**Architecture:** 先在 `index.html` 落新 token 并把旧变量名临时别名到暖色（保证每个 commit 应用都能看、能用），再逐组件换装并改用新 token，最后删别名做清扫。图标是手工内联的 lucide SVG（`Icon.vue`，零运行时依赖）。封面取色拆成纯函数（可单测）+ 浏览器壳。

**Tech Stack:** Vue 3 SFC + Vite（现状），vanilla CSS variables，node:test（仅 2 个纯函数测试），preview 工具截图验证。

**验证环境：** 后端 `npm start`（:8080）通常已在跑；前端预览用 `.claude/launch.json` 里现成的 `pwa-preview` 配置（:5199，避开用户自己的 :5173）。每个任务的"视觉验证"= 截图 + 对照该任务的核对清单。

**Git 纪律（CLAUDE.md）：** 每任务一个 commit（`feat(pwa)/refactor(pwa)/test(pwa)` scope 用 pwa），commit 后立刻 `git push`。

---

### Task 1: 色板 token + 字体基建（index.html）

**Files:**
- Modify: `pwa/index.html`

- [ ] **Step 1: 替换 `<head>` 里的字体链接与全部 `<style>`**

把 Google Fonts 那行 `<link href="https://fonts.googleapis.com/css2?family=VT323&family=JetBrains+Mono...">` 替换为：

```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
```

`<style>` 整块替换为（新 token + 旧名别名，别名让未改装组件先整体转暖、Task 12 删）：

```css
:root {
  /* night-issue tokens (spec §2) */
  --ink-0: #131110;
  --ink-1: #1b1916;
  --ink-2: #2c2823;
  --paper-0: #f3ead9;
  --paper-1: #ded5c6;
  --paper-2: #cabfae;
  --paper-3: #9b9184;
  --paper-4: #6e6357;
  --gold: #c2a36b;
  --negative: #c1573f;
  --rule: #5a5046;
  --ambient-glow: rgba(194, 163, 107, 0.14); /* JS 取色成功后被覆盖 */

  --font-serif: 'Noto Serif SC', 'Source Han Serif SC', 'STSong', serif;
  --font-sans: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', Consolas, monospace;

  /* legacy aliases — 仅为未换装组件过渡，Task 12 删除 */
  --bg: var(--ink-0);
  --panel: var(--ink-1);
  --panel-2: var(--ink-1);
  --border: var(--ink-2);
  --border-soft: var(--ink-2);
  --accent: var(--paper-0);
  --accent-dim: var(--paper-2);
  --text: var(--paper-1);
  --text-dim: var(--paper-3);
  --blue: var(--gold);
  --blue-dim: var(--rule);
  --blue-glow: rgba(194, 163, 107, 0.15);
  --warn: var(--negative);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font-serif);
  background: var(--ink-0);
  color: var(--paper-1);
  height: 100vh;
  overflow: hidden;        /* 页面不滚动,所有滚动发生在 DJLog 内部 */
}

#app {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 16px;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

::selection { background: var(--rule); color: var(--paper-0); }
```

要点：点阵网格背景与蓝色 radial 已随之删除；VT323 / Press Start 2P 不再加载。

- [ ] **Step 2: 视觉验证** — preview :5199 截图。核对：整体转为暖墨色；无点阵背景；功能一切照旧（旧组件经别名拿到暖色值）。

- [ ] **Step 3: Commit**

```bash
git add pwa/index.html
git commit -m "feat(pwa): night-issue tokens + serif font foundation"
git push
```

---

### Task 2: Icon.vue（lucide 内联 SVG，零依赖）

**Files:**
- Create: `pwa/src/components/Icon.vue`

- [ ] **Step 1: 新建组件（完整内容）**

```vue
<template>
  <svg
    :width="size" :height="size" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.75"
    stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" v-html="PATHS[name]"
  />
</template>

<script setup>
defineProps({ name: { type: String, required: true }, size: { type: [Number, String], default: 16 } });

// 路径取自 lucide（ISC license），手工内联避免运行时依赖
const PATHS = {
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'pause': '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  'skip-back': '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  'skip-forward': '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  'heart': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z"/>',
  'heart-crack': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.51 4.04 3 5.5l7 7Z"/><path d="m12 13-1-1 2-2-3-3 2-2"/>',
  'volume-2': '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  'volume-x': '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'repeat': '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  'ban': '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  'frown': '<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  'disc': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M6 12c0-1.7.7-3.2 1.8-4.2"/><path d="M18 12c0 1.7-.7 3.2-1.8 4.2"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
</script>
```

- [ ] **Step 2: Commit**（此时无使用方，渲染验证随 Task 3 一起做）

```bash
git add pwa/src/components/Icon.vue
git commit -m "feat(pwa): inline lucide icon component"
git push
```

---

### Task 3: AppHeader 刊头 + 日期线 + ON AIR 印章 + 离线提示 + App.vue 接线

**Files:**
- Modify: `pwa/src/components/AppHeader.vue`（整文件重写）
- Modify: `pwa/src/App.vue`

- [ ] **Step 1: 重写 AppHeader.vue（完整内容）**

```vue
<template>
  <header class="masthead">
    <div class="mast-row">
      <span class="wordmark">NightlinerFM</span>
      <div class="mast-actions">
        <transition name="fade">
          <span v-if="playing" class="on-air">ON AIR</span>
        </transition>
        <button class="nav-link" @click="$emit('open-queue')">QUEUE</button>
        <button class="nav-link" @click="$emit('open-tuning')">TUNING</button>
      </div>
    </div>
    <div class="dateline">{{ dateline }}</div>
    <div v-if="!connected" class="offline">OFFLINE — BACKEND NOT RESPONDING</div>
  </header>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

defineProps({ connected: Boolean, playing: Boolean });
defineEmits(['open-tuning', 'open-queue']);

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dateline = ref('');

function tick() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  dateline.value = `${DAYS[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}
let timer;
onMounted(() => { tick(); timer = setInterval(tick, 1000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.masthead { flex-shrink: 0; }
.mast-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 4px 12px;
  border-bottom: 1px solid var(--ink-2);
}
.wordmark {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--paper-0);
}
.mast-actions { display: flex; align-items: center; gap: 16px; }
.on-air {
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--gold);
  border: 1px solid var(--gold);
  border-radius: 2px;
  padding: 3px 8px;
  animation: breathe 2.4s ease-in-out infinite;
}
@keyframes breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.nav-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--paper-3);
  transition: color 0.18s;
}
.nav-link:hover { color: var(--paper-0); }
.dateline {
  text-align: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--ink-2);
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--paper-3);
}
.offline {
  text-align: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--negative);
}
</style>
```

- [ ] **Step 2: App.vue 接线**

`<script setup>` 加一个 ref（放在 `const thinking = ref(false);` 附近）：

```js
const playing = ref(false);
```

模板里 AppHeader 与 HeroCard 两行改为：

```html
<AppHeader :connected="connected" :playing="playing" @open-tuning="tuningOpen = true" @open-queue="queueOpen = true" />
<HeroCard
  :state="state"
  @feedback="onFeedback"
  @skip="onSkip"
  @previous="onPrevious"
  @user-message="pushDjMessage"
  @playing-change="playing = $event"
/>
```

（`@playing-change` 的发射端在 Task 4 加上；本任务先接好线，事件没来之前 ON AIR 不显示，正确。）

- [ ] **Step 3: 视觉验证** — 截图核对：衬线字标 NightlinerFM；日期线 `FRIDAY · 12 JUN 2026 · HH:MM` 走时；QUEUE/TUNING 文字链接可点开抽屉；ON AIR 暂不显示（事件未接通）；停掉后端再刷新出现红色 OFFLINE 行（验完恢复）。

- [ ] **Step 4: Commit**

```bash
git add pwa/src/components/AppHeader.vue pwa/src/App.vue
git commit -m "feat(pwa): masthead with dateline, ON AIR stamp, offline notice"
git push
```

---

### Task 4: HeroCard ① — 去卡片化、封面/歌名/编者按、playing-change 事件

**Files:**
- Modify: `pwa/src/components/HeroCard.vue`

- [ ] **Step 1: 模板改动**

删除整个 `<!-- Time row -->` 区块（时钟已迁到刊头）。封面与歌信息区替换为：

```html
<!-- Album cover -->
<div class="cover-wrap">
  <div class="cover-frame">
    <img v-if="state.now?.pic_url" :src="state.now.pic_url" :alt="state.now.title" class="cover-img" />
    <Icon v-else name="disc" :size="44" class="cover-empty-icon" />
  </div>
</div>

<!-- Song info -->
<template v-if="state.now">
  <div class="song-title">{{ state.now.title }}</div>
  <div class="song-artist">{{ state.now.ncm_artist || state.now.artist }}</div>
  <div v-if="state.now.memoryLink" class="liner-note">{{ state.now.memoryLink }}</div>
</template>
<div v-else class="empty-info">Nothing playing — ask for something</div>
```

- [ ] **Step 2: script 改动**

```js
import Icon from './Icon.vue';
```

`defineEmits` 加 `'playing-change'`：

```js
const emit = defineEmits(['feedback', 'skip', 'previous', 'user-message', 'playing-change']);
```

时钟相关代码删除（`timeStr`/`dateStr`/`DAYS`/`MONTHS`/`updateClock`/`clockTimer`，`onMounted`/`onUnmounted` 里只留 `applyVolume()` 与 `clearTimeout(bufferTimer)`）。加：

```js
watch([() => props.state.now, paused], ([now, p]) => {
  emit('playing-change', !!now && !p);
}, { immediate: true });
```

- [ ] **Step 3: 样式改动**（替换对应选择器；time-row/clock 系列选择器删除）

```css
.hero-card {
  background: none;
  border: none;
  border-bottom: 1px solid var(--ink-2);
  border-radius: 0;
  padding: 22px 4px 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  text-align: center;
}
.cover-wrap { display: flex; justify-content: center; margin-bottom: 16px; position: relative; }
.cover-wrap::before {
  content: '';
  position: absolute;
  inset: -48px;
  background: radial-gradient(circle, var(--ambient-glow), transparent 70%);
  pointer-events: none;
}
.cover-frame {
  width: 260px;
  height: 260px;
  border-radius: 14px;
  overflow: hidden;
  background: var(--ink-1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}
.cover-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-empty-icon { color: var(--paper-4); }
.song-title {
  font-family: var(--font-serif);
  font-size: 26px;
  font-weight: 500;
  color: var(--paper-0);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.song-artist {
  font-family: var(--font-sans);
  font-size: 10px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--paper-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 7px;
}
.liner-note {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 12px;
  color: var(--paper-3);
  margin-bottom: 4px;
}
.empty-info { color: var(--paper-4); padding: 16px 0 12px; font-size: 13px; font-family: var(--font-sans); }
```

- [ ] **Step 4: 视觉验证** — 截图核对：封面 260px 圆角正方形居中、后方鎏金微光；衬线歌名居中；艺人行大写大字距；memoryLink 是无边框斜体小字；刊头 ON AIR 开始呼吸闪烁，暂停后 ~0.3s 淡出。

- [ ] **Step 5: Commit**

```bash
git add pwa/src/components/HeroCard.vue
git commit -m "feat(pwa): editorial hero — rounded cover, serif title, playing-change emit"
git push
```

---

### Task 5: HeroCard ② — 进度条 + 时间显示切换

**Files:**
- Modify: `pwa/src/components/HeroCard.vue`

- [ ] **Step 1: 模板** — progress 区块替换为：

```html
<div v-if="state.now" class="progress-wrap">
  <div class="progress-track" :class="{ buffering }" @mousedown="onSeekStart" @touchstart.passive="onSeekStart">
    <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
    <div class="progress-thumb" :style="{ left: progressPct + '%' }"></div>
  </div>
  <div class="time-row">
    <span class="time-label" :class="{ 'buf-pulse': buffering }">{{ fmtTime(currentSec) }}</span>
    <button class="time-label time-toggle" @click="showRemaining = !showRemaining">{{ rightTimeLabel }}</button>
  </div>
</div>
```

- [ ] **Step 2: script** — 加：

```js
const showRemaining = ref(false);
const rightTimeLabel = computed(() =>
  showRemaining.value
    ? `−${fmtTime(Math.max(0, durationSec.value - currentSec.value))}`
    : fmtTime(durationSec.value)
);
```

（`computed` 需加入 vue import。）

- [ ] **Step 3: 样式** — 替换 progress 系列选择器：

```css
.progress-wrap { margin: 14px 0 0; }
.progress-track {
  height: 3px;
  background: var(--ink-2);
  border: none;
  border-radius: 2px;
  position: relative;
  cursor: pointer;
  user-select: none;
}
.progress-fill { height: 100%; background: var(--gold); border-radius: 2px; pointer-events: none; }
.progress-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--paper-0);
  pointer-events: none;
  z-index: 2;
}
.time-row { display: flex; justify-content: space-between; margin-top: 5px; }
.time-label {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--paper-4);
  min-width: 36px;
}
.time-toggle { background: none; border: none; padding: 0; cursor: pointer; text-align: right; }
.time-toggle:hover { color: var(--paper-2); }
.progress-track.buffering::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(90deg, transparent 0%, rgba(194, 163, 107, 0.45) 50%, transparent 100%);
  background-size: 45% 100%;
  background-repeat: no-repeat;
  animation: buf-sweep 1.1s ease-in-out infinite;
  pointer-events: none;
}
```

（`@keyframes buf-sweep`、`buf-thumb`、`buf-label` 保留，把其中 `rgba(74, 127, 219, …)` 全改成 `rgba(194, 163, 107, …)`。）

- [ ] **Step 4: 视觉验证** — 截图 + 操作：进度条 3px 鎏金；点右侧时间在 `04:43` ↔ `−02:55` 间切换；拖动 seek 正常、缓冲扫光为金色。

- [ ] **Step 5: Commit**

```bash
git add pwa/src/components/HeroCard.vue
git commit -m "feat(pwa): gold progress bar with total/remaining time toggle"
git push
```

---

### Task 6: HeroCard ③ — 控制行网格 + 音量滑出 + 碎心 + 英文面板

**Files:**
- Modify: `pwa/src/components/HeroCard.vue`

- [ ] **Step 1: 模板** — Controls row + dislike panel 替换为：

```html
<!-- Controls row: volume | transport (居中) | feedback -->
<div class="controls-row">
  <div class="volume-wrap">
    <button class="ghost-btn" @click="toggleMute" :title="muted ? 'Unmute' : 'Mute'">
      <Icon :name="muted ? 'volume-x' : 'volume-2'" :size="16" />
    </button>
    <input type="range" min="0" max="100" step="1" v-model.number="volume"
      class="vol-slider" :style="volTrackStyle" @input="onVolumeChange" />
  </div>

  <div class="transport">
    <button class="ghost-btn" title="Previous" @click="onPrevious"><Icon name="skip-back" :size="16" /></button>
    <button class="ghost-btn play-btn" :title="paused ? 'Play' : 'Pause'" @click="togglePlay">
      <Icon :name="paused ? 'play' : 'pause'" :size="22" />
    </button>
    <button class="ghost-btn" title="Skip" @click="onSkip"><Icon name="skip-forward" :size="16" /></button>
  </div>

  <div class="feedback-zone" @mouseenter="feedbackHovered = true" @mouseleave="feedbackHovered = false">
    <transition name="dislike-reveal">
      <button v-if="feedbackHovered || dislikePanelOpen"
        class="ghost-btn fb-dislike" :class="{ flashed: dislikePanelOpen, 'sticky-flash': stickyFlash }"
        title="Not feeling it" @click="dislikePanelOpen = !dislikePanelOpen">
        <Icon name="heart-crack" :size="16" />
      </button>
    </transition>
    <button class="ghost-btn fb-love" :class="{ flashed: flashedSignal === 'love' }" title="Love" @click="quickLove">
      <Icon name="heart" :size="16" />
    </button>
  </div>
</div>

<transition name="dislike-panel">
  <div v-if="dislikePanelOpen" class="dislike-panel">
    <div class="panel-header">Not feeling it — why? <span class="panel-hint">(pick one · note optional)</span></div>
    <div class="radio-row">
      <label v-for="opt in DISLIKE_OPTIONS" :key="opt.signal"
        class="radio-pill" :class="{ active: selectedSignal === opt.signal }">
        <input type="radio" name="dislike-signal" :value="opt.signal" v-model="selectedSignal" />
        <Icon :name="opt.icon" :size="14" /><span class="radio-label">{{ opt.label }}</span>
      </label>
    </div>
    <textarea v-model="dislikeReason" class="reason-input" placeholder="optional note" rows="2" maxlength="200"></textarea>
    <div class="panel-actions">
      <button class="panel-btn cancel" @click="cancelDislike">Cancel</button>
      <button class="panel-btn submit" :disabled="!selectedSignal" @click="submitDislike">Send</button>
    </div>
  </div>
</transition>
```

- [ ] **Step 2: script** — `DISLIKE_OPTIONS` 替换为：

```js
const DISLIKE_OPTIONS = [
  { signal: 'wrong_vibe',   icon: 'frown',  label: 'Wrong vibe' },
  { signal: 'too_familiar', icon: 'repeat', label: 'Too familiar' },
  { signal: 'never_again',  icon: 'ban',    label: 'Never again' },
];
```

加音量轨道填充：

```js
const volTrackStyle = computed(() => ({
  background: `linear-gradient(to right, var(--gold) ${volume.value}%, var(--ink-2) ${volume.value}%)`,
}));
```

- [ ] **Step 3: 样式** — 删除 `.ctrl-btn`/`.ctrl-spacer`/`.fb-btn`/`.vol-btn` 及 `.fb-dislike { font-family: Arial …}` 区块，替换 controls/feedback/volume/panel 系列为：

```css
.controls-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 6px 0 16px;
}
.ghost-btn {
  background: none;
  border: none;
  padding: 6px;
  cursor: pointer;
  color: var(--paper-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.18s, transform 0.18s;
}
.ghost-btn:hover { color: var(--paper-0); }
.ghost-btn:active { transform: scale(0.92); }
.transport { display: flex; align-items: center; gap: 18px; }
.play-btn { color: var(--paper-0); }
.volume-wrap { display: flex; align-items: center; justify-self: start; }
.vol-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 0;
  opacity: 0;
  height: 3px;
  border-radius: 2px;
  border: none;
  outline: none;
  cursor: pointer;
  transition: width 0.18s ease, opacity 0.18s ease;
}
.volume-wrap:hover .vol-slider, .vol-slider:focus-visible { width: 64px; opacity: 1; margin-left: 4px; }
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 9px; height: 9px;
  background: var(--paper-0);
  border: none; border-radius: 50%;
  cursor: pointer;
}
.vol-slider::-moz-range-thumb {
  width: 9px; height: 9px;
  background: var(--paper-0);
  border: none; border-radius: 50%;
  cursor: pointer;
}
.feedback-zone { display: flex; align-items: center; gap: 10px; justify-self: end; }
.fb-love { color: var(--gold); }
.fb-love.flashed { color: var(--gold); transform: scale(1.18); }
.fb-dislike { color: var(--paper-2); }
.fb-dislike:hover, .fb-dislike.flashed, .fb-dislike.sticky-flash { color: var(--negative); }
.dislike-panel {
  margin: 0 0 14px;
  padding: 14px 16px;
  background: var(--ink-1);
  border: 1px solid var(--ink-2);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  text-align: left;
}
.panel-header { font-family: var(--font-sans); font-size: 12px; color: var(--paper-1); letter-spacing: 0.5px; }
.panel-hint { color: var(--paper-4); font-size: 10px; margin-left: 4px; }
.radio-row { display: flex; gap: 8px; flex-wrap: wrap; }
.radio-pill {
  flex: 1;
  min-width: 90px;
  cursor: pointer;
  padding: 8px 10px;
  border: 1px solid var(--ink-2);
  border-radius: 6px;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--paper-3);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: border-color 0.18s, color 0.18s;
}
.radio-pill:hover { border-color: var(--rule); color: var(--paper-1); }
.radio-pill.active { border-color: var(--negative); color: var(--paper-0); }
.radio-pill input[type="radio"] { position: absolute; opacity: 0; pointer-events: none; }
.reason-input {
  background: var(--ink-0);
  border: 1px solid var(--ink-2);
  color: var(--paper-1);
  padding: 8px 10px;
  font-family: var(--font-sans);
  font-size: 12px;
  resize: none;
  outline: none;
  border-radius: 6px;
  width: 100%;
}
.reason-input:focus { border-color: var(--rule); }
.reason-input::placeholder { color: var(--paper-4); }
.panel-actions { display: flex; gap: 8px; justify-content: flex-end; }
.panel-btn {
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: 1px;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid var(--ink-2);
  background: transparent;
  color: var(--paper-3);
  transition: all 0.18s;
}
.panel-btn.cancel:hover { color: var(--paper-1); border-color: var(--paper-4); }
.panel-btn.submit { background: var(--gold); color: var(--ink-0); border-color: var(--gold); }
.panel-btn.submit:disabled { opacity: 0.3; cursor: not-allowed; }
.panel-btn.submit:hover:not(:disabled) { opacity: 0.85; }
```

（`dislike-panel-*` 与 `dislike-reveal-*` 过渡保留不动。）

- [ ] **Step 4: 视觉验证** — 截图 + 操作核对：传输键严格居中；hover 音量图标滑条滑出、填充鎏金；hover ❤ 碎心浮现、hover 碎心转砖红；点碎心面板展开（英文文案、三个描边图标）；提交一条 wrong_vibe 走通（后端 200）。

- [ ] **Step 5: Commit**

```bash
git add pwa/src/components/HeroCard.vue
git commit -m "feat(pwa): centered transport grid, slide-out volume, heart-crack feedback"
git push
```

---

### Task 7: 封面取色（TDD）

**Files:**
- Create: `pwa/src/utils/ambient.js`
- Create: `tests/ambient.test.js`
- Modify: `pwa/src/components/HeroCard.vue`

- [ ] **Step 1: 写失败测试** `tests/ambient.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageRgb } from '../pwa/src/utils/ambient.js';

test('averageRgb: 单像素返回该像素', () => {
  assert.deepEqual(averageRgb(new Uint8ClampedArray([10, 20, 30, 255])), { r: 10, g: 20, b: 30 });
});

test('averageRgb: 红蓝各半取均值', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  assert.deepEqual(averageRgb(data), { r: 128, g: 0, b: 128 });
});

test('averageRgb: 空数据回退 null', () => {
  assert.equal(averageRgb(new Uint8ClampedArray([])), null);
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test tests/ambient.test.js`，预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现** `pwa/src/utils/ambient.js`：

```js
// 封面取色:纯函数可单测,浏览器壳负责 canvas/CORS。
// 网易云 CDN 不放行 CORS 时 extractAmbient 返回 null,调用方回退鎏金(spec §8)。

export function averageRgb(data) {
  if (!data || data.length < 4) return null;
  let r = 0, g = 0, b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

export function extractAmbient(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 32, 32);
        resolve(averageRgb(ctx.getImageData(0, 0, 32, 32).data));
      } catch { resolve(null); } // canvas tainted = CORS 拒绝
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test tests/ambient.test.js`，预期 3 pass。

- [ ] **Step 5: HeroCard 集成** — script 加：

```js
import { extractAmbient } from '../utils/ambient.js';

watch(() => props.state.now?.pic_url, async (url) => {
  const rgb = url ? await extractAmbient(url) : null;
  const glow = rgb
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`
    : 'rgba(194, 163, 107, 0.14)';
  document.documentElement.style.setProperty('--ambient-glow', glow);
}, { immediate: true });
```

- [ ] **Step 6: 视觉验证** — 换一首封面色彩鲜明的歌，截图核对封面后方微光随封面变色；若 CORS 拒绝则保持鎏金（console 无报错）。

- [ ] **Step 7: Commit**

```bash
git add pwa/src/utils/ambient.js tests/ambient.test.js pwa/src/components/HeroCard.vue
git commit -m "feat(pwa): ambient glow from album art with gold fallback"
git push
```

---

### Task 8: DJLog 文字稿体例

**Files:**
- Modify: `pwa/src/components/DJLog.vue`

- [ ] **Step 1: script** — `speakerLabel` 替换为：

```js
function speakerLabel(msg) {
  if (msg.kind === 'user' || msg.kind === 'reaction') return 'YOU';
  if (msg.kind === 'system') return 'SYSTEM';
  return 'DJ';
}
```

- [ ] **Step 2: 模板** — 去掉终端提示符，msg-body 各分支替换为：

```html
<div class="msg-body" :class="bodyClass(msg)">
  <template v-if="msg.kind === 'song'">
    <span class="song-prefix">{{ msg.title }}</span> — {{ displayText(i, msg) }}
  </template>
  <template v-else-if="msg.kind === 'opening' || msg.kind === 'chat_reply'">{{ displayText(i, msg) }}</template>
  <template v-else-if="msg.kind === 'user'">{{ msg.text }}</template>
  <template v-else-if="msg.kind === 'stream'">{{ msg.text }}<span v-if="msg.id === streamingId" class="stream-caret">▍</span></template>
  <template v-else-if="msg.kind === 'reaction'">
    <span class="reaction-text">reacted: {{ msg.text }}</span>
  </template>
  <template v-else>{{ msg.text }}</template>
</div>
```

空态 `(waiting for DJ...)` 改为 `Waiting for the DJ…`。

- [ ] **Step 3: 样式** — `<style scoped>` 中消息相关选择器替换为：

```css
.speaker {
  font-family: var(--font-sans);
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--paper-3);
}
.speaker-user { color: var(--paper-3); }
.speaker-chat, .speaker-claude { color: var(--paper-3); }
.system-label { color: var(--negative); }
.ts { font-family: var(--font-mono); font-size: 10px; color: var(--paper-4); opacity: 1; }
.msg-body {
  font-family: var(--font-serif);
  font-size: 15px;
  color: var(--paper-1);
  line-height: 1.9;
  white-space: pre-line;
}
.user-body, .reaction-body {
  font-style: italic;
  font-size: 14px;
  color: var(--paper-3);
  border-left: 2px solid var(--rule);
  padding-left: 10px;
}
.reaction-body { font-size: 12px; }
.song-body { color: var(--paper-1); }
.song-prefix { color: var(--paper-0); font-weight: 500; }
.chat-reply-body, .stream-body { color: var(--paper-1); }
.stream-caret { color: var(--gold); margin-left: 1px; animation: caretBlink 1s steps(1) infinite; }
.warn-text { color: var(--negative); font-family: var(--font-mono); font-size: 12px; }
.empty { font-size: 13px; color: var(--paper-4); padding: 4px 0; font-family: var(--font-sans); }
```

滚动条三处颜色：thumb `var(--ink-2)`、hover `var(--paper-4)`、`scrollbar-color: var(--ink-2) transparent`。`.cli-prompt`/`.chat-prompt`/`.user-prompt` 选择器删除。

- [ ] **Step 4: 视觉验证** — 发一条消息走完整轮：YOU 引文体（斜体+左竖线）、DJ 衬线正文、流式金色 ▍、song 消息歌名加重、`/help` 输出 mono 脚注体、`/stats` 等 emoji 输出本任务不管（系统消息内容来自 App.vue，Task 12 清理）。

- [ ] **Step 5: Commit**

```bash
git add pwa/src/components/DJLog.vue
git commit -m "feat(pwa): transcript-style DJ log with serif body and quote rules"
git push
```

---

### Task 9: ChatInput 页脚化 + greetings 重写（TDD）

**Files:**
- Create: `tests/greetings.test.js`
- Modify: `pwa/src/utils/greetings.js`（整文件重写）
- Modify: `pwa/src/components/ChatInput.vue`

- [ ] **Step 1: 写失败测试** `tests/greetings.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickGreeting } from '../pwa/src/utils/greetings.js';

const HOURS = [7, 13, 19, 23, 3];

test('pickGreeting: 各时段都返回非空纯 ASCII 英文', () => {
  for (const h of HOURS) {
    for (let i = 0; i < 20; i++) {
      const g = pickGreeting(new Date(2026, 5, 12, h));
      assert.ok(g.length > 0);
      assert.match(g, /^[\x20-\x7E]+$/, `non-ASCII greeting at hour ${h}: ${g}`);
    }
  }
});

test('pickGreeting: 不再出现破折号抒情体', () => {
  for (const h of HOURS) {
    for (let i = 0; i < 20; i++) {
      assert.ok(!pickGreeting(new Date(2026, 5, 12, h)).includes('—'));
    }
  }
});
```

- [ ] **Step 2: 跑测试确认失败** — `node --test tests/greetings.test.js`，预期 FAIL（现库返回中文）。

- [ ] **Step 3: 重写** `pwa/src/utils/greetings.js`：

```js
// Pick a random greeting based on current time of day.
// 文案纪律(spec §6):全英文、短句、正常语气,禁止破折号抒情体。
const POOLS = {
  morning: [   // 5:00 - 11:00
    "Morning. What's first?",
    'Something easy to start with?',
    'What do you want to hear?',
    'Pick the first track of the day',
  ],
  afternoon: [ // 11:00 - 17:00
    'What do you want to hear?',
    'Need focus or a break?',
    'Something for the afternoon?',
    'Name a song, an artist, or a mood',
  ],
  evening: [   // 17:00 - 22:00
    'Done for the day. What now?',
    "Pick tonight's first track",
    'Loud or quiet tonight?',
    'What do you want to hear?',
  ],
  night: [     // 22:00 - 2:00
    'Something quiet?',
    'What do you want to hear tonight?',
    'Slow ones from here?',
    'Name a mood',
  ],
  lateNight: [ // 2:00 - 5:00
    'Still up? Name a song or a mood.',
    'Something low for the late hours?',
    'One more before bed?',
    'What do you want to hear?',
  ],
};

export function pickGreeting(now = new Date()) {
  const h = now.getHours();
  let pool;
  if (h >= 5 && h < 11) pool = POOLS.morning;
  else if (h >= 11 && h < 17) pool = POOLS.afternoon;
  else if (h >= 17 && h < 22) pool = POOLS.evening;
  else if (h >= 22 || h < 2) pool = POOLS.night;
  else pool = POOLS.lateNight;
  return pool[Math.floor(Math.random() * pool.length)];
}
```

- [ ] **Step 4: 跑测试确认通过** — `node --test tests/greetings.test.js`，预期 2 pass。

- [ ] **Step 5: ChatInput 改装** — 模板 busy placeholder 改 `'DJ is on it…'`；发送按钮内容换 `<Icon name="arrow-up" :size="15" />`（script 加 `import Icon from './Icon.vue';`）。样式整块替换：

```css
.chat-pill {
  display: flex;
  align-items: center;
  height: 52px;
  border: none;
  border-top: 1px solid var(--ink-2);
  border-radius: 0;
  background: transparent;
  padding: 8px 4px;
  flex-shrink: 0;
}
input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--paper-1);
  font-family: var(--font-serif);
  font-size: 14px;
  outline: none;
  padding: 0;
  min-width: 0;
}
input::placeholder { color: var(--paper-4); }
.send-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--gold);
  background: transparent;
  color: var(--gold);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.18s, color 0.18s, opacity 0.18s;
}
.send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.send-btn:hover:not(:disabled) { background: var(--gold); color: var(--ink-0); }
```

（`.chat-pill.focused` 选择器删除；App.vue 里 `发送失败 — 后端没响应…` 文案改为 `Send failed — is the backend running?`。）

- [ ] **Step 6: 视觉验证** — 截图：页脚无盒、placeholder 为新英文短句；发送圆钮 hover 填金；发消息流程正常。

- [ ] **Step 7: Commit**

```bash
git add tests/greetings.test.js pwa/src/utils/greetings.js pwa/src/components/ChatInput.vue pwa/src/App.vue
git commit -m "feat(pwa): footer chat input + plain-English greeting copy (tested)"
git push
```

---

### Task 10: ThinkingIndicator 英文化 + StatusBar 删除

**Files:**
- Modify: `pwa/src/components/ThinkingIndicator.vue`
- Delete: `pwa/src/components/StatusBar.vue`
- Modify: `pwa/src/App.vue`

- [ ] **Step 1: ThinkingIndicator** — label 改 `Picking the next one…`，样式替换：

```css
.label {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 13px;
  color: var(--paper-3);
}
.dot { animation: blink 1.2s infinite; color: var(--gold); font-size: 18px; line-height: 1; }
```

- [ ] **Step 2: 删除 StatusBar** — `git rm pwa/src/components/StatusBar.vue`；App.vue 删 import 与 `<StatusBar :connected="connected" />`；`.app-shell` 的 `padding-bottom: 36px` 改 `padding-bottom: 8px`（注释一并删）。

- [ ] **Step 3: 视觉验证** — 截图：底部状态栏消失、布局不留空洞；发消息时出现斜体 `Picking the next one…` + 金色点。

- [ ] **Step 4: Commit**

```bash
git add -A pwa/src/components/StatusBar.vue pwa/src/components/ThinkingIndicator.vue pwa/src/App.vue
git commit -m "feat(pwa): drop status bar, serif thinking indicator"
git push
```

---

### Task 11: 抽屉换装（Queue + Tuning）

**Files:**
- Modify: `pwa/src/components/QueueDrawer.vue`
- Modify: `pwa/src/components/TuningDrawer.vue`

- [ ] **Step 1: QueueDrawer** — 标题行替换（ASCII 框线删除）：

```html
<span class="drawer-title">QUEUE — {{ queue?.length || 0 }} TRACKS</span>
<button class="close-btn" @click="$emit('close')"><Icon name="x" :size="14" /></button>
```

（script 加 `import Icon from './Icon.vue';`；空态文字改 `Queue is empty — ask for something`。）样式替换：

```css
.drawer { background: var(--ink-1); border-left: 1px solid var(--ink-2); }
.drawer-title { font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px; color: var(--paper-3); }
.close-btn {
  background: none; border: none; color: var(--paper-3);
  width: 28px; height: 28px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.18s;
}
.close-btn:hover { color: var(--paper-0); }
.queue-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; font-size: 13px; color: var(--paper-3);
  cursor: pointer; transition: background 0.1s;
  border-left: 2px solid transparent;
}
.queue-row:hover { background: rgba(194, 163, 107, 0.07); }
.queue-row.current { background: none; border-left-color: var(--gold); color: var(--gold); box-shadow: none; }
.idx { font-family: var(--font-mono); font-size: 10px; min-width: 22px; color: var(--paper-4); flex-shrink: 0; }
.song-name { font-family: var(--font-serif); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.song-artist { font-family: var(--font-sans); font-size: 11px; color: var(--paper-4); text-align: right; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.queue-row.current .song-artist { color: var(--gold); }
.empty { font-size: 12px; color: var(--paper-4); padding: 8px 0; font-family: var(--font-sans); }
```

- [ ] **Step 2: TuningDrawer** — 标题 `⚙ 调音台` 改 `TUNING`（同 QueueDrawer 的 title/close 样式与 Icon close 按钮）；两个 label 改 `EXPLORATION` / `QUEUE LENGTH`；样式替换：

```css
.drawer { background: var(--ink-1); border-left: 1px solid var(--ink-2); }
.slider-label { display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px; color: var(--paper-3); }
.val { color: var(--gold); font-weight: 500; letter-spacing: 0.5px; }
.ticks { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 9px; color: var(--paper-4); margin-top: 2px; }
.ticks .on { color: var(--gold); }
.slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 3px;
  background: var(--ink-2);
  border: none; border-radius: 2px;
  outline: none; cursor: pointer;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px;
  background: var(--paper-0);
  border: none; border-radius: 50%;
  cursor: pointer;
}
.slider::-moz-range-thumb { width: 14px; height: 14px; background: var(--paper-0); border: none; border-radius: 50%; cursor: pointer; }
```

- [ ] **Step 3: 视觉验证** — 两个抽屉各截一张：纸面板、大写标题、当前歌鎏金左线、滑杆圆 thumb、无 ASCII 框线无 ⚙。

- [ ] **Step 4: Commit**

```bash
git add pwa/src/components/QueueDrawer.vue pwa/src/components/TuningDrawer.vue
git commit -m "feat(pwa): editorial queue and tuning drawers"
git push
```

---

### Task 12: 清扫 — 删别名、扫残留、prod 构建

**Files:**
- Modify: `pwa/index.html`、`pwa/src/App.vue`、残留命中文件

- [ ] **Step 1: 删除 index.html 里的 legacy aliases 区块**（`--bg` 到 `--warn` 那 13 行及注释）。

- [ ] **Step 2: 扫残留** — 逐个跑，命中则改成新 token / Icon / 英文文案：

```bash
grep -rnE '#5b9bd5|#7fb8e0|#d8506e|4a7fdb|VT323|Press Start|--blue|--accent|--panel|--border|--text-dim|--warn|--bg' pwa/src pwa/index.html
grep -rnE '⏮|⏭|⏸|☰|⚙|✕|🔊|🔇|🔁|🚫|❤|♥' pwa/src
```

已知命中需处理：App.vue `/help`、`/anti`、`/cooldown`、`/stats` 系统输出里的 emoji（🚫→`[ban]` 前缀直接删掉用纯文本、❤→`love:`、✗→`wrong_vibe:`、🔁→保持纯文本），这些是 mono 脚注体输出，纯文本即可。

- [ ] **Step 3: 全量测试 + 构建**

```bash
node --test tests/ambient.test.js tests/greetings.test.js   # 预期 5 pass
npm --prefix pwa run build                                   # 预期构建成功
```

- [ ] **Step 4: 最终视觉验收** — :5199 截图完整一页（播放中 + 对话若干条），对照 spec §5 十一项逐条过；另截一张暂停态（ON AIR 隐藏）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(pwa): drop legacy palette aliases, sweep stray glyphs"
git push
```

---

## Self-Review 记录

- **Spec 覆盖**：§2 色板→T1/T12；§3 字体→T1 + 各组件任务；§4 图标→T2 + T4/6/9/11/12；§5.1-5.3→T3；§5.4→T4；§5.5→T5；§5.6→T6；§5.7→T8；§5.8→T9；§5.9→T11；§5.10→T3+T4（playing 接线）；§5.11→T6；§6 文案→T9（greetings/发送失败）+T4/8/10/11（空态/标签）；§7 动效→各任务内嵌；§8 ambient 回退→T7。无缺口。
- **占位符**：无 TBD/“适当处理”；每步含完整代码或精确命令。
- **命名一致性**：`playing-change`（T3 接线 = T4 发射）；`Icon` name 串与 T2 PATHS 键一一对应（play/pause/skip-back/skip-forward/heart/heart-crack/volume-2/volume-x/arrow-up/repeat/ban/frown/disc/x）；token 名全程 `--ink-*/--paper-*/--gold/--negative/--rule/--ambient-glow`。
