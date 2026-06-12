<template>
  <transition name="drawer">
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">QUEUE — {{ queue?.length || 0 }} TRACKS</span>
          <button class="close-btn" @click="$emit('close')"><Icon name="x" :size="14" /></button>
        </div>

        <div class="queue-body">
          <div v-if="!queue || queue.length === 0" class="empty">
            Queue is empty — ask for something
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
import Icon from './Icon.vue';

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
  background: var(--ink-1);
  border-left: 1px solid var(--ink-2);
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
.drawer-title { font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px; color: var(--paper-3); }
.close-btn {
  background: none; border: none; color: var(--paper-3);
  width: 28px; height: 28px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.18s;
}
.close-btn:hover { color: var(--paper-0); }

.queue-body { flex: 1; overflow-y: auto; }
.empty { font-size: 12px; color: var(--paper-4); padding: 8px 0; font-family: var(--font-sans); }
.queue-list { display: flex; flex-direction: column; gap: 2px; }
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

.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
