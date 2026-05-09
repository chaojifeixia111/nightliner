<template>
  <transition name="drawer">
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">┌─ QUEUE ({{ queue?.length || 0 }} tracks) ─┐</span>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>

        <div class="queue-body">
          <div v-if="!queue || queue.length === 0" class="empty">
            ( queue empty · chat to start )
          </div>
          <div v-else class="queue-list">
            <div
              v-for="(song, idx) in queue"
              :key="song.title + song.artist"
              class="queue-row"
              :class="{ current: isNow(song) }"
              @click="skipTo(song)"
              :title="`跳转: ${song.title}`"
            >
              <span class="idx">{{ String(idx + 1).padStart(2, '0') }}</span>
              <span class="song-name">{{ song.title }}</span>
              <span class="song-artist">{{ song.ncm_artist || song.artist }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
const props = defineProps({
  open: Boolean,
  queue: Array,
  now: Object,
});
defineEmits(['close']);

function isNow(song) {
  return props.now && props.now.title === song.title;
}

function skipTo(song) {
  fetch('/api/skip-to', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: song.title, artist: song.artist }),
  });
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
  justify-content: flex-end;
}
.drawer {
  background: var(--panel);
  border-left: 1px solid var(--border);
  width: 320px;
  max-width: 90vw;
  height: 100%;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.drawer-title {
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 1px;
}
.close-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, border-color 0.15s;
}
.close-btn:hover { color: var(--accent); border-color: var(--accent-dim); }

.queue-body { flex: 1; overflow-y: auto; }
.empty {
  font-size: 12px;
  color: var(--text-dim);
  padding: 8px 0;
}
.queue-list { display: flex; flex-direction: column; gap: 2px; }
.queue-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.1s;
  border-left: 3px solid transparent;
}
.queue-row:hover { background: rgba(74, 127, 219, 0.08); }
.queue-row.current {
  background: var(--blue-glow);
  border-left-color: var(--accent);
  color: var(--accent);
  box-shadow: inset 0 0 24px rgba(74, 127, 219, 0.08);
}
.idx {
  font-size: 10px;
  min-width: 22px;
  opacity: 0.6;
  flex-shrink: 0;
}
.song-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.song-artist {
  font-size: 11px;
  color: var(--text-dim);
  text-align: right;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
  flex-shrink: 0;
}
.queue-row.current .song-artist { color: var(--accent); }

.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
