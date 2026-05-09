<template>
  <div v-if="show" class="thinking">
    <span class="label">:CLAUDE</span>
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
  gap: 8px;
  padding: 6px 0;
  font-size: 11px;
}
.label {
  font-family: 'Press Start 2P', monospace;
  font-size: 7px;
  color: var(--text-dim);
  letter-spacing: 1px;
}
.dot {
  animation: blink 1.2s infinite;
  color: var(--accent);
  font-size: 16px;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink {
  0%, 80%, 100% { opacity: 0; }
  40% { opacity: 1; }
}
</style>
