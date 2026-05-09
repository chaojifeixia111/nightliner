<template>
  <div class="status-bar">
    <span class="fm-label">NIGHTLINERFM</span>
    <span class="conn" :class="{ connected }">
      <span class="dot">{{ connected ? '●' : '○' }}</span>
      {{ connected ? 'CONNECTED' : 'DISCONNECTED' }}
    </span>
  </div>
</template>

<script setup>
defineProps({ connected: Boolean });
</script>

<style scoped>
.status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--panel);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 24px;
  font-size: 10px;
  letter-spacing: 1.5px;
  z-index: 100;
}
.fm-label { color: var(--text-dim); }
.conn { color: var(--text-dim); }
.conn.connected { color: var(--accent); }
.dot { margin-right: 4px; }
</style>
