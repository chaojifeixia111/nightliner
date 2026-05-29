<template>
  <div class="hero-card">
    <!-- Time row -->
    <div class="time-row">
      <div class="time-left">
        <span class="clock-time">{{ timeStr }}</span>
        <span class="clock-date">{{ dateStr }}</span>
      </div>
      <div class="on-air">
        <span class="air-dot">●</span>
        <span class="air-label">ON AIR</span>
      </div>
    </div>

    <!-- Album cover -->
    <div class="cover-wrap">
      <div class="cover-frame" :class="{ 'has-cover': state.now?.pic_url }">
        <img
          v-if="state.now?.pic_url"
          :src="state.now.pic_url"
          :alt="state.now.title"
          class="cover-img"
        />
        <span v-else class="cover-empty">○ no signal</span>
      </div>
    </div>

    <!-- Song info -->
    <template v-if="state.now">
      <div class="song-title">{{ state.now.title }}</div>
      <div class="song-artist">{{ state.now.ncm_artist || state.now.artist }}</div>
      <div v-if="state.now.memoryLink" class="memory-link">[ {{ state.now.memoryLink }} ]</div>
    </template>
    <div v-else class="empty-info">( no signal · chat to start )</div>

    <!-- Progress bar -->
    <div v-if="state.now" class="progress-wrap">
      <span class="time-label" :class="{ 'buf-pulse': buffering }">{{ fmtTime(currentSec) }}</span>
      <div class="progress-track" :class="{ buffering }" @mousedown="onSeekStart" @touchstart.passive="onSeekStart">
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
        <div class="progress-thumb" :style="{ left: progressPct + '%' }"></div>
      </div>
      <span class="time-label">{{ fmtTime(durationSec) }}</span>
    </div>

    <!-- Controls row -->
    <div class="controls-row">
      <!-- Transport buttons -->
      <button class="ctrl-btn" title="上一首" @click="onPrevious">⏮</button>
      <button class="ctrl-btn play-btn" @click="togglePlay">{{ paused ? '▶' : '⏸' }}</button>
      <button class="ctrl-btn" title="跳过" @click="onSkip">⏭</button>

      <div class="ctrl-spacer"></div>

      <!-- Feedback: ❤ always visible, hover to reveal × -->
      <div
        class="feedback-zone"
        @mouseenter="feedbackHovered = true"
        @mouseleave="feedbackHovered = false"
      >
        <transition name="dislike-reveal">
          <button
            v-if="feedbackHovered || dislikePanelOpen"
            class="fb-btn fb-dislike"
            :class="{ flashed: dislikePanelOpen, 'sticky-flash': stickyFlash }"
            title="不喜欢…"
            @click="dislikePanelOpen = !dislikePanelOpen"
          >×</button>
        </transition>
        <button
          class="fb-btn fb-love"
          :class="{ flashed: flashedSignal === 'love' }"
          title="喜欢"
          @click="quickLove"
        >♥</button>
      </div>

      <!-- Volume -->
      <div class="volume-wrap">
        <button class="ctrl-btn vol-btn" @click="toggleMute" title="静音">{{ muted ? '🔇' : '🔊' }}</button>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          v-model.number="volume"
          class="vol-slider"
          @input="onVolumeChange"
        />
      </div>
    </div>

    <transition name="dislike-panel">
      <div v-if="dislikePanelOpen" class="dislike-panel">
        <div class="panel-header">为什么不喜欢? <span class="panel-hint">(选一个 · 文字可选)</span></div>
        <div class="radio-row">
          <label
            v-for="opt in DISLIKE_OPTIONS"
            :key="opt.signal"
            class="radio-pill"
            :class="{ active: selectedSignal === opt.signal }"
          >
            <input
              type="radio"
              name="dislike-signal"
              :value="opt.signal"
              v-model="selectedSignal"
            />
            <span class="radio-label">{{ opt.emoji }} {{ opt.label }}</span>
          </label>
        </div>
        <textarea
          v-model="dislikeReason"
          class="reason-input"
          placeholder="例:听腻了 / 旋律太密 / 不在状态"
          rows="2"
          maxlength="200"
        ></textarea>
        <div class="panel-actions">
          <button class="panel-btn cancel" @click="cancelDislike">取消</button>
          <button
            class="panel-btn submit"
            :disabled="!selectedSignal"
            @click="submitDislike"
          >提交</button>
        </div>
      </div>
    </transition>

    <audio
      ref="audio"
      :src="state.now?.url"
      autoplay
      preload="auto"
      @ended="onEnded"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onMeta"
      @seeking="startBuffering"
      @waiting="startBuffering"
      @stalled="startBuffering"
      @seeked="stopBuffering"
      @playing="stopBuffering"
      @canplay="stopBuffering"
    />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({ state: Object });
const emit = defineEmits(['feedback', 'skip', 'previous', 'user-message']);

// Clock state
const timeStr = ref('');
const dateStr = ref('');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  timeStr.value = `${h}:${m}`;
  dateStr.value = `${DAYS[now.getDay()]} · ${String(now.getDate()).padStart(2, '0')} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

let clockTimer;
onMounted(() => { updateClock(); clockTimer = setInterval(updateClock, 1000); applyVolume(); });
onUnmounted(() => { clearInterval(clockTimer); clearTimeout(bufferTimer); });

// Audio state
const audio = ref(null);
const paused = ref(false);
const muted = ref(false);
// 音量:记住用户手动调过的值(localStorage),首次默认 33(别一打开就吵)
const VOLUME_KEY = 'nl_volume';
function loadVolume() {
  const raw = localStorage.getItem(VOLUME_KEY);
  if (raw === null || raw === '') return 33;   // 没存过 → 默认 33(注意 Number(null)===0,必须先判空)
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 33;
}
const volume = ref(loadVolume());
const currentSec = ref(0);
const durationSec = ref(0);
const progressPct = ref(0);
let lastReportedSec = 0;
let seeking = false;
const buffering = ref(false);   // seek 后等待 CDN 重新缓冲时的观感指示
let bufferTimer = null;

// Feedback state
const feedbackHovered = ref(false); // ❤ 上 hover 才显示 ×
const dislikePanelOpen = ref(false);
const selectedSignal = ref(null);   // 'wrong_vibe' | 'too_familiar' | 'never_again'
const dislikeReason = ref('');
const stickyFlash = ref(false);     // confirmation pulse after dislike submit
const flashedSignal = ref(null);

const DISLIKE_OPTIONS = [
  { signal: 'wrong_vibe',   emoji: '×',  label: '不对味' },
  { signal: 'too_familiar', emoji: '🔁', label: '太熟了' },
  { signal: 'never_again',  emoji: '🚫', label: '别再播' },
];

function fmtTime(sec) {
  const s = Math.floor(sec || 0);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function onTimeUpdate() {
  if (!audio.value || seeking) return;
  currentSec.value = audio.value.currentTime;
  durationSec.value = audio.value.duration || 0;
  lastReportedSec = Math.floor(audio.value.currentTime);
  progressPct.value = durationSec.value > 0 ? (currentSec.value / durationSec.value) * 100 : 0;
}

function onMeta() {
  if (audio.value) durationSec.value = audio.value.duration || 0;
  applyVolume();   // 每首歌加载时把音量落到元素上(autoplay 默认是 100%)
}

// seek / 卡顿后的"缓冲中"观感:只有卡顿超过 ~180ms 才显示,
// 这样命中已缓冲区间的瞬时 seek 不会闪一下指示。
function startBuffering() {
  clearTimeout(bufferTimer);
  bufferTimer = setTimeout(() => { buffering.value = true; }, 180);
}
function stopBuffering() {
  clearTimeout(bufferTimer);
  buffering.value = false;
}

function togglePlay() {
  if (!audio.value) return;
  if (audio.value.paused) { audio.value.play(); paused.value = false; }
  else { audio.value.pause(); paused.value = true; stopBuffering(); }
}

function toggleMute() {
  if (!audio.value) return;
  muted.value = !muted.value;
  audio.value.muted = muted.value;
}

function applyVolume() {
  if (audio.value) audio.value.volume = volume.value / 100;
}

function onVolumeChange() {
  applyVolume();
  try { localStorage.setItem(VOLUME_KEY, String(volume.value)); } catch {}
}

function onEnded() {
  reportPlayEvent('natural', Math.floor(audio.value?.duration || 0));
}

function onSkip() {
  if (!props.state.now) return;
  emit('skip');
  reportPlayEvent('user_skip', lastReportedSec);
}

function onPrevious() {
  emit('previous');
}

// 从指针/触摸事件里算出在轨道上的比例 [0,1]
function seekPctFromEvent(track, ev) {
  const rect = track.getBoundingClientRect();
  const clientX = ev.touches?.[0]?.clientX
    ?? ev.changedTouches?.[0]?.clientX
    ?? ev.clientX;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function onSeekStart(e) {
  if (!audio.value) return;
  // 必须现在就把轨道元素存下来:e.currentTarget 在本次事件派发结束后会被浏览器置空,
  // 延迟触发的 move/end(挂在 window 上)里再读 e.currentTarget 就是 null。
  const track = e.currentTarget;
  seeking = true;
  // 按下即跳:进度条立刻反映点击/按下位置
  progressPct.value = seekPctFromEvent(track, e) * 100;

  const move = (ev) => {
    progressPct.value = seekPctFromEvent(track, ev) * 100;
  };
  const end = (ev) => {
    seeking = false;
    const pct = seekPctFromEvent(track, ev);
    progressPct.value = pct * 100;
    if (audio.value && durationSec.value > 0) {
      audio.value.currentTime = pct * durationSec.value;
    }
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', end);
    window.removeEventListener('touchmove', move);
    window.removeEventListener('touchend', end);
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  window.addEventListener('touchmove', move, { passive: true });
  window.addEventListener('touchend', end);
}

watch(() => props.state.now?.title, (newTitle, oldTitle) => {
  if (oldTitle && oldTitle !== newTitle) lastReportedSec = 0;
  currentSec.value = 0;
  durationSec.value = 0;
  progressPct.value = 0;
  paused.value = false;
  stopBuffering();
});

function reportPlayEvent(reason, playedSec) {
  if (!props.state.now) return;
  fetch('/api/play-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: props.state.now.title,
      artist: props.state.now.artist,
      duration_sec: Math.floor(audio.value?.duration || 0),
      played_sec: playedSec,
      ended_reason: reason,
    }),
  });
}

function quickLove() {
  emit('feedback', { signal: 'love', reason: null });
  flashedSignal.value = 'love';
  setTimeout(() => { flashedSignal.value = null; }, 2000);
}

function submitDislike() {
  if (!selectedSignal.value) return;
  emit('feedback', {
    signal: selectedSignal.value,
    reason: dislikeReason.value.trim() || null,
  });
  // visual confirmation
  stickyFlash.value = true;
  setTimeout(() => { stickyFlash.value = false; }, 2500);
  // reset and close
  dislikePanelOpen.value = false;
  selectedSignal.value = null;
  dislikeReason.value = '';
}

function cancelDislike() {
  dislikePanelOpen.value = false;
  selectedSignal.value = null;
  dislikeReason.value = '';
}
</script>

<style scoped>
.hero-card {
  background:
    radial-gradient(ellipse 60% 30% at 50% 0%, var(--blue-glow), transparent 70%),
    var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Time row */
.time-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-soft);
  margin-bottom: 16px;
}
.time-left {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.clock-time {
  font-family: 'VT323', monospace;
  font-size: 28px;
  color: var(--accent);
  line-height: 1;
}
.clock-date {
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.5px;
}
.on-air {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  letter-spacing: 1px;
}
.air-dot {
  color: var(--blue);
  animation: pulse 1.4s ease-in-out infinite;
  text-shadow: 0 0 6px var(--blue);
}
.air-label {
  font-family: 'JetBrains Mono', monospace;
  color: var(--accent);
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}

/* Album cover */
.cover-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}
.cover-frame {
  width: 240px;
  height: 240px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}
.cover-frame:not(.has-cover) {
  border-style: dashed;
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-empty {
  font-size: 13px;
  color: var(--text-dim);
  letter-spacing: 1px;
}

/* Song info */
.song-title {
  font-family: 'VT323', monospace;
  font-size: 32px;
  color: var(--accent);
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.song-artist {
  font-size: 13px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}
.memory-link {
  display: inline-block;
  font-size: 11px;
  font-variant: small-caps;
  color: var(--accent);
  border: 1px solid var(--blue);
  background: var(--blue-glow);
  padding: 2px 8px;
  margin-bottom: 12px;
  letter-spacing: 0.5px;
  box-shadow: 0 0 12px rgba(74, 127, 219, 0.15);
}
.empty-info {
  text-align: center;
  color: var(--text-dim);
  padding: 16px 0 12px;
  font-size: 13px;
}

/* Progress */
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 8px;
}
.time-label {
  font-size: 11px;
  color: var(--text-dim);
  min-width: 36px;
}
.progress-track {
  flex: 1;
  height: 6px;
  background: #0a1024;
  border: 1px solid var(--border);
  position: relative;
  cursor: pointer;
  user-select: none;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--blue) 0%, var(--accent) 100%);
  box-shadow: 0 0 8px rgba(74, 127, 219, 0.5);
  pointer-events: none;
}
.progress-thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  background: var(--accent);
  border: 1px solid var(--bg);
  pointer-events: none;
  z-index: 2;   /* 保持在缓冲微光之上 */
}

/* Buffering:seek 命中未缓冲区间、等 CDN 回数据时的观感指示 */
.progress-track.buffering::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(90deg, transparent 0%, rgba(74, 127, 219, 0.45) 50%, transparent 100%);
  background-size: 45% 100%;
  background-repeat: no-repeat;
  animation: buf-sweep 1.1s ease-in-out infinite;
  pointer-events: none;
}
@keyframes buf-sweep {
  0% { background-position: -45% 0; }
  100% { background-position: 145% 0; }
}
.progress-track.buffering .progress-thumb {
  animation: buf-thumb 1.1s ease-in-out infinite;
}
@keyframes buf-thumb {
  0%, 100% { box-shadow: 0 0 0 0 rgba(74, 127, 219, 0); }
  50% { box-shadow: 0 0 8px 2px rgba(74, 127, 219, 0.6); }
}
.time-label.buf-pulse {
  animation: buf-label 1.1s ease-in-out infinite;
}
@keyframes buf-label {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; color: var(--accent); }
}

/* Controls row */
.controls-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}
.ctrl-spacer { flex: 1; }
.ctrl-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 14px;
  width: 36px;
  height: 36px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  border-radius: 2px;
}
.ctrl-btn:hover {
  color: var(--accent);
  border-color: var(--blue);
  background: var(--blue-glow);
}
.play-btn {
  font-size: 16px;
  width: 44px;
  height: 44px;
  border-color: var(--accent-dim);
  color: var(--accent);
}

/* Feedback zone */
.feedback-zone {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
}
.fb-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 14px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, border-color 0.15s, background 0.15s, box-shadow 0.15s;
  border-radius: 2px;
}
.fb-love {
  color: var(--accent);
  border-color: var(--blue);
}
.fb-love.flashed {
  background: rgba(220, 80, 110, 0.25);
  border-color: #d8506e;
  color: #ffb3c1;
  box-shadow: 0 0 14px rgba(216, 80, 110, 0.5);
}
.fb-dislike {
  color: var(--text-dim);
  border-color: var(--border);
}
.fb-dislike:hover {
  color: var(--accent);
  border-color: var(--blue);
}
.fb-dislike.flashed {
  background: var(--blue-glow);
  border-color: var(--blue);
  color: var(--accent);
}
.fb-dislike.sticky-flash {
  background: var(--blue-glow);
  border-color: var(--blue);
  color: var(--accent);
  box-shadow: 0 0 12px var(--blue-glow);
}

/* Dislike panel */
.dislike-panel {
  margin-top: 12px;
  padding: 14px 16px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel-header {
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 0.5px;
}
.panel-hint {
  color: var(--text-dim);
  font-size: 10px;
  margin-left: 4px;
}
.radio-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.radio-pill {
  flex: 1;
  min-width: 90px;
  cursor: pointer;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.radio-pill:hover { border-color: var(--blue-dim); color: var(--text); }
.radio-pill.active {
  border-color: var(--blue);
  color: var(--accent);
  background: var(--blue-glow);
}
.radio-pill input[type="radio"] {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.reason-input {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 8px 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  resize: none;
  outline: none;
  border-radius: 4px;
  width: 100%;
  box-sizing: border-box;
}
.reason-input:focus { border-color: var(--blue); }
.reason-input::placeholder { color: var(--text-dim); opacity: 0.7; }
.panel-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.panel-btn {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  transition: all 0.15s;
}
.panel-btn.cancel:hover { color: var(--text); border-color: var(--text-dim); }
.panel-btn.submit {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.panel-btn.submit:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.panel-btn.submit:hover:not(:disabled) { opacity: 0.85; }

.dislike-panel-enter-active,
.dislike-panel-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.dislike-panel-enter-from,
.dislike-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* × 按钮 hover 展开动效 */
.dislike-reveal-enter-active,
.dislike-reveal-leave-active {
  transition: opacity 0.18s, transform 0.18s;
}
.dislike-reveal-enter-from,
.dislike-reveal-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* × 用直线字体(避免衬线弯角) */
.fb-dislike {
  font-family: Arial, sans-serif;  /* Arial 的 × 是干净的直线 */
  font-size: 18px;
  font-weight: 300;
  line-height: 1;
}

/* Volume */
.volume-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.vol-btn {
  font-size: 13px;
}
.vol-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 80px;
  height: 4px;
  background: #0a1024;
  border: 1px solid var(--border);
  outline: none;
  cursor: pointer;
}
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  background: var(--accent);
  cursor: pointer;
  border: 1px solid var(--bg);
  border-radius: 50%;
}
.vol-slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: var(--accent);
  cursor: pointer;
  border: 1px solid var(--bg);
  border-radius: 50%;
}
</style>
