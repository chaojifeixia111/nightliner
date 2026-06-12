<template>
  <div class="hero-card">
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

    <!-- Progress bar -->
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
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import Icon from './Icon.vue';
import { extractAmbient } from '../utils/ambient.js';

const props = defineProps({ state: Object });
const emit = defineEmits(['feedback', 'skip', 'previous', 'user-message', 'playing-change']);

onMounted(() => { applyVolume(); });
onUnmounted(() => { clearTimeout(bufferTimer); });

// Audio state
const audio = ref(null);
const paused = ref(false);

watch([() => props.state.now, paused], ([now, p]) => {
  emit('playing-change', !!now && !p);
}, { immediate: true });

watch(() => props.state.now?.pic_url, async (url) => {
  const rgb = url ? await extractAmbient(url) : null;
  const glow = rgb
    ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`
    : 'rgba(194, 163, 107, 0.14)';
  document.documentElement.style.setProperty('--ambient-glow', glow);
}, { immediate: true });

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
const showRemaining = ref(false);
const rightTimeLabel = computed(() =>
  showRemaining.value
    ? `−${fmtTime(Math.max(0, durationSec.value - currentSec.value))}`
    : fmtTime(durationSec.value)
);
let lastReportedSec = 0;
let seeking = false;
const buffering = ref(false);   // seek 后等待 CDN 重新缓冲时的观感指示
let bufferTimer = null;

// Feedback state
const feedbackHovered = ref(false); // hover to reveal dislike button
const dislikePanelOpen = ref(false);
const selectedSignal = ref(null);   // 'wrong_vibe' | 'too_familiar' | 'never_again'
const dislikeReason = ref('');
const stickyFlash = ref(false);     // confirmation pulse after dislike submit
const flashedSignal = ref(null);

const DISLIKE_OPTIONS = [
  { signal: 'wrong_vibe',   icon: 'frown',  label: 'Wrong vibe' },
  { signal: 'too_familiar', icon: 'repeat', label: 'Too familiar' },
  { signal: 'never_again',  icon: 'ban',    label: 'Never again' },
];

const volTrackStyle = computed(() => ({
  background: `linear-gradient(to right, var(--gold) ${volume.value}%, var(--ink-2) ${volume.value}%)`,
}));

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

/* Album cover */
.cover-wrap { display: flex; justify-content: center; margin-bottom: 16px; position: relative; }
.cover-wrap::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 480px;
  height: 480px;
  transform: translate(-50%, -50%);
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

/* Progress */
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

/* Buffering:seek 命中未缓冲区间、等 CDN 回数据时的观感指示 */
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
@keyframes buf-sweep {
  0% { background-position: -45% 0; }
  100% { background-position: 145% 0; }
}
.progress-track.buffering .progress-thumb {
  animation: buf-thumb 1.1s ease-in-out infinite;
}
@keyframes buf-thumb {
  0%, 100% { box-shadow: 0 0 0 0 rgba(194, 163, 107, 0); }
  50% { box-shadow: 0 0 8px 2px rgba(194, 163, 107, 0.6); }
}
.time-label.buf-pulse {
  animation: buf-label 1.1s ease-in-out infinite;
}
@keyframes buf-label {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; color: var(--paper-0); }
}

/* Controls row */
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

.dislike-panel-enter-active,
.dislike-panel-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.dislike-panel-enter-from,
.dislike-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* dislike-reveal hover slide-in animation */
.dislike-reveal-enter-active,
.dislike-reveal-leave-active {
  transition: opacity 0.18s, transform 0.18s;
}
.dislike-reveal-enter-from,
.dislike-reveal-leave-to {
  opacity: 0;
  transform: translateX(8px);
}
</style>
