<template>
  <header class="masthead">
    <div class="mast-row">
      <span class="wordmark">NightlinerFM</span>
      <div class="mast-actions">
        <transition name="fade">
          <span v-if="playing" class="on-air">ON AIR</span>
        </transition>
        <button class="icon-link" @click="$emit('open-listen')" aria-label="Listen"><Icon name="layout-grid" :size="15" /></button>
        <button class="nav-link" @click="$emit('open-tuning')">TUNING</button>
      </div>
    </div>
    <div class="dateline">{{ dateline }}</div>
    <div v-if="!connected" class="offline">OFFLINE — BACKEND NOT RESPONDING</div>
  </header>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import Icon from './Icon.vue';

defineProps({ connected: Boolean, playing: Boolean });
defineEmits(['open-tuning', 'open-listen']);

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dateline = ref('');

function tick() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  dateline.value = `${DAYS[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}
let timer;
onMounted(() => { tick(); timer = setInterval(tick, 1000); });
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.masthead { flex-shrink: 0; }
.mast-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 4px 12px;
  border-bottom: 1px solid var(--ink-2);
}
.wordmark {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--paper-0);
}
.mast-actions { display: flex; align-items: center; gap: 16px; }
.on-air {
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--gold);
  border: 1px solid var(--gold);
  border-radius: 2px;
  padding: 3px 8px;
  animation: breathe 2.4s ease-in-out infinite;
}
@keyframes breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.nav-link {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: 1.5px;
  color: var(--paper-3);
  transition: color 0.18s;
}
.nav-link:hover { color: var(--paper-0); }
.icon-link {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--paper-3); display: flex; align-items: center;
  transition: color 0.18s;
}
.icon-link:hover { color: var(--paper-0); }
.dateline {
  text-align: center;
  padding: 7px 0;
  border-bottom: 1px solid var(--ink-2);
  font-family: var(--font-sans);
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--paper-3);
}
.offline {
  text-align: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--ink-2);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--negative);
}

/* 窄屏:4 个导航 + ON AIR 挤不下一行 → 缩字距、ON AIR 退化成呼吸金点 */
@media (max-width: 480px) {
  .wordmark { font-size: 15px; }
  .mast-actions { gap: 10px; }
  .nav-link { font-size: 10px; letter-spacing: 1px; }
  .on-air {
    font-size: 0;
    letter-spacing: 0;
    padding: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gold);
    border: none;
  }
}
</style>
