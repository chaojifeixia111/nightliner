<template>
  <div class="subtitle-bar">
    <p v-if="text">{{ text }}</p>
    <p v-else class="hint">(等 DJ 发话)</p>
  </div>
</template>

<script setup>
defineProps({ text: String });
</script>

<style scoped>
.subtitle-bar {
  min-height: 64px;
  background: #1a1a1a;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 16px 0;
  white-space: pre-line;
  line-height: 1.5;
}
.hint { color: #555; }
</style>
