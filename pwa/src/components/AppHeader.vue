<template>
  <header class="app-header">
    <div class="header-left">
      <span class="logo">NIGHTLINER</span>
      <span class="theme-badge">DARK</span>
    </div>
    <button class="gear-btn" title="调音台" @click="$emit('open-tuning')">⚙</button>
  </header>
</template>

<script setup>
defineEmits(['open-tuning']);
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logo {
  font-family: 'Press Start 2P', monospace;
  font-size: 13px;
  color: var(--accent);
  letter-spacing: 2px;
}
.theme-badge {
  font-size: 9px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  padding: 2px 6px;
  letter-spacing: 1px;
}
.gear-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 16px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, border-color 0.15s;
}
.gear-btn:hover {
  color: var(--accent);
  border-color: var(--accent-dim);
}
</style>
