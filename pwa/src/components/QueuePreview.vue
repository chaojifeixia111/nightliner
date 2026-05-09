<template>
  <div class="queue-card">
    <div class="card-label">┌─ QUEUE ─┐</div>
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
        <span class="song-artist">{{ song.artist }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({ queue: Array, now: Object });

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
.queue-card {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 16px;
  margin-bottom: 12px;
}
.card-label {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 10px;
  letter-spacing: 1px;
}
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
  padding: 5px 8px;
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
}
.song-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.song-artist {
  font-size: 11px;
  color: var(--text-dim);
  margin-left: auto;
  text-align: right;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}
.queue-row.current .song-artist { color: var(--accent); }
</style>
