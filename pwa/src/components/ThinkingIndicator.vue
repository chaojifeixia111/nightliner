<template>
  <div v-if="show" class="thinking">
    <span class="label">DJ 正在选歌</span>
    <span class="dots">
      <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
    </span>
  </div>
</template>

<script setup>
defineProps({ show: Boolean });
</script>

<style scoped>
.thinking {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  font-size: 13px;
}
.label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: var(--accent);
  letter-spacing: 0.5px;
}
.dot {
  animation: blink 1.2s infinite;
  color: var(--accent);
  font-size: 18px;
  line-height: 1;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink {
  0%, 80%, 100% { opacity: 0; }
  40% { opacity: 1; }
}
</style>
