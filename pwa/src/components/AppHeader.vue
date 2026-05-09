<template>
  <header class="app-header">
    <span class="logo">NIGHTLINER</span>
    <div class="header-actions">
      <button class="icon-btn" title="队列" @click="$emit('open-queue')">☰</button>
      <button class="icon-btn" title="调音台" @click="$emit('open-tuning')">⚙</button>
    </div>
  </header>
</template>

<script setup>
defineEmits(['open-tuning', 'open-queue']);
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 4px;
  flex-shrink: 0;
}
.logo {
  font-family: 'Press Start 2P', monospace;
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 4px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.icon-btn {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--accent);
  font-size: 15px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.icon-btn:hover {
  border-color: var(--blue);
  box-shadow: 0 0 8px var(--blue-glow);
}
</style>
