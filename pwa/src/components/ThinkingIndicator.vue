<template>
  <div v-if="show" class="thinking">
    <span class="label">Thinking</span>
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
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 13px;
  color: var(--paper-3);
}
.dot { animation: blink 1.2s infinite; color: var(--gold); font-size: 18px; line-height: 1; }
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink {
  0%, 80%, 100% { opacity: 0; }
  40% { opacity: 1; }
}
</style>
