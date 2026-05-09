<template>
  <div class="player-card">
    <div class="card-label">┌─ NOW PLAYING ─┐</div>

    <div v-if="state.now" class="now-playing">
      <div class="song-title">{{ state.now.title }}</div>
      <div class="song-artist">{{ state.now.ncm_artist || state.now.artist }}</div>
      <div v-if="state.now.memoryLink" class="memory-link">[ {{ state.now.memoryLink }} ]</div>

      <div class="progress-wrap">
        <span class="time-label">{{ fmtTime(currentSec) }}</span>
        <div class="progress-track" @mousedown="onSeekStart" @touchstart.passive="onSeekStart">
          <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
          <div class="progress-thumb" :style="{ left: progressPct + '%' }"></div>
        </div>
        <span class="time-label">{{ fmtTime(durationSec) }}</span>
      </div>

      <div class="controls">
        <button class="ctrl-btn" title="上一首" disabled>⏮</button>
        <button class="ctrl-btn play-btn" @click="togglePlay">{{ paused ? '▶' : '⏸' }}</button>
        <button class="ctrl-btn" title="跳过" @click="onSkip">⏭</button>
        <button class="ctrl-btn mute-btn" @click="toggleMute">{{ muted ? '🔇' : '🔊' }}</button>
        <button class="ctrl-btn love-btn" @click="$emit('feedback', 'love')" title="喜欢">♥</button>
      </div>
    </div>

    <div v-else class="empty-state">
      <span>( no signal · chat to start )</span>
    </div>

    <audio
      ref="audio"
      :src="state.now?.url"
      autoplay
      @ended="onEnded"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onMeta"
    />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({ state: Object });
const emit = defineEmits(['feedback', 'skip']);

const audio = ref(null);
const paused = ref(false);
const muted = ref(false);
const currentSec = ref(0);
const durationSec = ref(0);
const progressPct = ref(0);
let lastReportedSec = 0;
let seeking = false;

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
}

function togglePlay() {
  if (!audio.value) return;
  if (audio.value.paused) { audio.value.play(); paused.value = false; }
  else { audio.value.pause(); paused.value = true; }
}

function toggleMute() {
  if (!audio.value) return;
  muted.value = !muted.value;
  audio.value.muted = muted.value;
}

function onEnded() {
  reportPlayEvent('natural', Math.floor(audio.value?.duration || 0));
}

function onSkip() {
  if (!props.state.now) return;
  emit('skip');
  reportPlayEvent('user_skip', lastReportedSec);
}

// Seek: pointer/touch on progress track
function onSeekStart(e) {
  if (!audio.value) return;
  seeking = true;
  const move = (ev) => {
    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    progressPct.value = pct * 100;
  };
  const end = (ev) => {
    seeking = false;
    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const clientX = ev.changedTouches ? ev.changedTouches[0].clientX : ev.clientX;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
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
  if (oldTitle && oldTitle !== newTitle && lastReportedSec > 0) {
    // Track switched externally
    lastReportedSec = 0;
  }
  currentSec.value = 0;
  durationSec.value = 0;
  progressPct.value = 0;
  paused.value = false;
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
</script>

<style scoped>
.player-card {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 16px;
  margin-bottom: 12px;
}
.card-label {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 12px;
  letter-spacing: 1px;
}
.song-title {
  font-family: 'VT323', monospace;
  font-size: 28px;
  color: var(--text);
  line-height: 1.1;
  margin-bottom: 4px;
}
.song-artist {
  font-size: 12px;
  color: var(--text-dim);
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
.progress-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
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
}
.controls {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
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
  transition: color 0.15s, border-color 0.15s;
}
.ctrl-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent-dim);
}
.ctrl-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.play-btn { font-size: 16px; width: 44px; height: 44px; border-color: var(--accent-dim); color: var(--accent); }
.love-btn { margin-left: auto; }
.empty-state {
  text-align: center;
  color: var(--text-dim);
  padding: 28px 0;
  font-size: 13px;
}
</style>
