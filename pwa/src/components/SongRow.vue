<template>
  <div class="song-row" :class="{ current: isNow }" @click="$emit('play', song)" :title="`Play ${song.name}`">
    <span class="name">{{ song.name }}</span>
    <span class="artist">{{ song.artist }}</span>
    <button class="add" @click.stop="$emit('queue', song)" :aria-label="`Queue ${song.name}`">
      <Icon name="plus" :size="14" />
    </button>
  </div>
</template>

<script setup>
import Icon from './Icon.vue';

defineProps({ song: Object, isNow: Boolean });
defineEmits(['play', 'queue']);
</script>

<style scoped>
.song-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; font-size: 13px; color: var(--paper-3);
  cursor: pointer; transition: background 0.1s;
  border-left: 2px solid transparent;
}
.song-row:hover { background: rgba(194, 163, 107, 0.07); }
.song-row.current { border-left-color: var(--gold); color: var(--gold); }
.name { font-family: var(--font-serif); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artist { font-family: var(--font-sans); font-size: 11px; color: var(--paper-4); text-align: right; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.song-row.current .artist { color: var(--gold); }
.add {
  background: none; border: none; padding: 0; flex-shrink: 0;
  width: 24px; height: 24px; cursor: pointer; color: var(--paper-4);
  display: flex; align-items: center; justify-content: center;
  transition: color 0.18s;
}
.add:hover { color: var(--paper-0); }
</style>
