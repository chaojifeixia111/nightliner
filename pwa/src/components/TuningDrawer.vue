<template>
  <transition name="drawer">
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">TUNING</span>
          <button class="close-btn" @click="$emit('close')"><Icon name="x" :size="14" /></button>
        </div>

        <div class="slider-group">
          <label class="slider-label">
            <span>EXPLORATION</span>
            <span class="val">{{ currentMode.en }}</span>
          </label>
          <input
            type="range"
            min="0" max="100" step="25"
            v-model.number="local.exploration_pct"
            class="slider"
          />
          <div class="ticks">
            <span v-for="m in MODES" :key="m.value" :class="{ on: m.value === currentMode.value }">{{ m.en }}</span>
          </div>
        </div>

        <div class="slider-group">
          <label class="slider-label">
            <span>QUEUE LENGTH</span>
            <span class="val">{{ local.queue_length }}</span>
          </label>
          <input
            type="range"
            min="5" max="30" step="1"
            v-model.number="local.queue_length"
            class="slider"
          />
        </div>

      </div>
    </div>
  </transition>
</template>

<script setup>
import { reactive, watch, computed, nextTick } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({ open: Boolean, tuning: Object });
const emit = defineEmits(['close', 'change']);

const local = reactive({
  exploration_pct: 30,
  queue_length: 10,
});

// 只在抽屉打开、把后端值灌进 local 之后才允许上报,避免初始同步触发一次空 POST
let live = false;
watch(() => props.open, (v) => {
  live = false;
  if (v && props.tuning) {
    Object.assign(local, props.tuning);
    local.exploration_pct = nearestMode(local.exploration_pct).value;  // 吸附到最近档位
    nextTick(() => { live = true; });
  }
});

// 拖动/点击即生效:防抖后直接上报,不再需要手动「应用」
let debounce = null;
watch(local, (val) => {
  if (!live) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => emit('change', { ...val }), 250);
}, { deep: true });

// 与后端 exploration-modes.js 对齐的 5 个命名档位(名字 + 一句话描述)
const MODES = [
  { value: 0, name: '舒适区', en: 'Comfort' },
  { value: 25, name: '偏熟悉', en: 'Cozy' },
  { value: 50, name: '平衡', en: 'Balanced' },
  { value: 75, name: '偏探索', en: 'Venture' },
  { value: 100, name: '狂野', en: 'Wild' },
];
function nearestMode(v) {
  return MODES.reduce((b, m) => Math.abs(m.value - v) < Math.abs(b.value - v) ? m : b, MODES[0]);
}
const currentMode = computed(() => nearestMode(local.exploration_pct));
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
  display: flex;
  justify-content: flex-end;
}
.drawer {
  background: var(--ink-1);
  border-left: 1px solid var(--ink-2);
  width: 320px;
  max-width: 90vw;
  height: 100%;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow-y: auto;
}
.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.drawer-title { font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px; color: var(--paper-3); }
.close-btn {
  background: none; border: none; color: var(--paper-3);
  width: 28px; height: 28px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.18s;
}
.close-btn:hover { color: var(--paper-0); }
.slider-group { display: flex; flex-direction: column; gap: 6px; }
.slider-label { display: flex; justify-content: space-between; font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px; color: var(--paper-3); }
.val { color: var(--gold); font-weight: 500; letter-spacing: 0.5px; }
.hint { font-size: 10px; color: var(--paper-3); }
.ticks { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 9px; color: var(--paper-4); margin-top: 2px; }
.ticks .on { color: var(--gold); }
.slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 3px;
  background: var(--ink-2);
  border: none; border-radius: 2px;
  outline: none; cursor: pointer;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px;
  background: var(--paper-0);
  border: none; border-radius: 50%;
  cursor: pointer;
}
.slider::-moz-range-thumb { width: 14px; height: 14px; background: var(--paper-0); border: none; border-radius: 50%; cursor: pointer; }
.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
