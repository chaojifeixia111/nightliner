<template>
  <div class="song-card" :class="{ current: isNow }" @click="$emit('play', song)" :title="`Play ${song.name}`">
    <div class="cover">
      <img v-if="song.pic_url" :src="song.pic_url" :alt="song.name" loading="lazy" />
      <Icon v-else name="disc" :size="28" class="cover-empty" />
      <button class="add" @click.stop="$emit('queue', song)" :aria-label="`Queue ${song.name}`">
        <Icon name="plus" :size="13" />
      </button>
    </div>
    <div class="name">{{ song.name }}</div>
    <div class="artist">{{ song.artist }}<span v-if="isNow" class="playing-tag"> · playing</span></div>
  </div>
</template>

<script setup>
import Icon from './Icon.vue';

defineProps({ song: Object, isNow: Boolean });
defineEmits(['play', 'queue']);
</script>

<style scoped>
.song-card { cursor: pointer; min-width: 0; }
.cover {
  position: relative; aspect-ratio: 1;
  border: 1px solid var(--ink-2); border-radius: 6px;
  overflow: hidden; background: var(--ink-1);
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.18s;
}
.song-card:hover .cover { border-color: var(--rule); }
.song-card.current .cover { border-color: var(--gold); }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-empty { color: var(--paper-4); }
.add {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px; border-radius: 50%;
  border: 1px solid var(--paper-3); background: rgba(19, 17, 16, 0.6);
  color: var(--paper-1); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.18s, border-color 0.18s;
}
.add:hover { color: var(--gold); border-color: var(--gold); }
.name {
  font-family: var(--font-serif); font-size: 13px; color: var(--paper-1);
  margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.song-card.current .name { color: var(--gold); }
.artist {
  font-family: var(--font-sans); font-size: 11px; color: var(--paper-4);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.playing-tag { color: var(--gold); }
</style>
