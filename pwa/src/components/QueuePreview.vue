<template>
  <div class="queue-preview">
    <div v-if="upcoming.length === 0" class="empty">(queue 已结束)</div>
    <div v-else>
      <div class="next">→ {{ upcoming[0].title }} - {{ upcoming[0].artist }}</div>
      <div v-if="upcoming.length > 1" class="rest">
        ... 还有 {{ upcoming.length - 1 }} 首
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ queue: Array, now: Object });

const upcoming = computed(() => {
  if (!props.queue) return [];
  if (!props.now) return props.queue;
  const idx = props.queue.findIndex(s => s.title === props.now.title);
  return idx >= 0 ? props.queue.slice(idx + 1) : props.queue;
});
</script>

<style scoped>
.queue-preview { padding: 12px; background: #111; border-radius: 8px; margin: 16px 0; }
.next { font-size: 14px; color: #ccc; }
.rest { color: #666; font-size: 12px; margin-top: 4px; }
.empty { color: #555; }
</style>
