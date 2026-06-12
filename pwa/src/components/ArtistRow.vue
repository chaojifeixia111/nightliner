<template>
  <div class="artist-row" @click="$emit('open', artist)" :title="`Open ${artist.name}`">
    <img v-if="artist.pic_url" :src="artist.pic_url" :alt="artist.name" class="avatar" loading="lazy" />
    <span v-else class="avatar avatar-empty"></span>
    <span class="name">{{ artist.name }}</span>
    <Icon name="chevron-right" :size="14" class="chev" />
  </div>
</template>

<script setup>
import Icon from './Icon.vue';

defineProps({ artist: Object });
defineEmits(['open']);
</script>

<style scoped>
.artist-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px; cursor: pointer; transition: background 0.1s;
  border-left: 2px solid transparent;
}
.artist-row:hover { background: rgba(194, 163, 107, 0.07); }
.avatar {
  width: 30px; height: 30px; border-radius: 50%;
  object-fit: cover; flex-shrink: 0;
  background: var(--ink-2); display: inline-block;
}
.name { font-family: var(--font-serif); font-size: 13px; color: var(--paper-1); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { color: var(--paper-4); flex-shrink: 0; }
</style>
