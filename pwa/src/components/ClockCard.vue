<template>
  <div class="clock-card">
    <div class="card-label">┌─ CLOCK ─┐</div>
    <div class="clock-body">
      <div class="clock-time">{{ timeStr }}</div>
      <div class="clock-date">{{ dateStr }}</div>
      <div class="on-air"><span class="dot">●</span> ON AIR</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const timeStr = ref('');
const dateStr = ref('');

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function update() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  timeStr.value = `${h}:${m}`;
  dateStr.value = `${DAYS[now.getDay()]} · ${String(now.getDate()).padStart(2, '0')} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

let timer;
onMounted(() => { update(); timer = setInterval(update, 1000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.clock-card {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 16px;
  margin-bottom: 12px;
}
.card-label {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 12px;
  letter-spacing: 1px;
}
.clock-body {
  display: flex;
  align-items: baseline;
  gap: 20px;
  flex-wrap: wrap;
}
.clock-time {
  font-family: 'VT323', monospace;
  font-size: 96px;
  color: var(--accent);
  line-height: 1;
}
.clock-date {
  font-size: 12px;
  color: var(--text-dim);
  letter-spacing: 1px;
}
.on-air {
  font-size: 11px;
  color: var(--accent);
  letter-spacing: 2px;
  margin-left: auto;
}
.dot {
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
</style>
