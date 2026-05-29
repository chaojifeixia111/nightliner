<template>
  <transition name="drawer">
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer">
        <div class="drawer-header">
          <span class="drawer-title">⚙ 调音台</span>
          <button class="close-btn" @click="$emit('close')">✕</button>
        </div>

        <div class="slider-group">
          <label class="slider-label">
            <span>探索档位</span>
            <span class="val">{{ currentMode.name }} · {{ currentMode.en }}</span>
          </label>
          <input
            type="range"
            min="0" max="100" step="25"
            v-model.number="local.exploration_pct"
            class="slider"
          />
          <div class="ticks">
            <span v-for="m in MODES" :key="m.value" :class="{ on: m.value === currentMode.value }">{{ m.name }}</span>
          </div>
          <div class="hint">{{ currentMode.desc }}</div>
        </div>

        <div class="slider-group">
          <label class="slider-label">
            <span>Queue 长度</span>
            <span class="val">{{ local.queue_length }}</span>
          </label>
          <input
            type="range"
            min="5" max="30" step="1"
            v-model.number="local.queue_length"
            class="slider"
          />
        </div>

        <div class="radio-group">
          <div class="slider-label"><span>话密度</span></div>
          <div class="radio-row">
            <button
              v-for="opt in ['low', 'medium', 'high']"
              :key="opt"
              class="radio-btn"
              :class="{ active: local.chattiness === opt }"
              @click="local.chattiness = opt"
            >{{ opt }}</button>
          </div>
        </div>

      </div>
    </div>
  </transition>
</template>

<script setup>
import { reactive, watch, computed, nextTick } from 'vue';

const props = defineProps({ open: Boolean, tuning: Object });
const emit = defineEmits(['close', 'change']);

const local = reactive({
  exploration_pct: 30,
  queue_length: 10,
  chattiness: 'medium',
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
  { value: 0, name: '舒适区', en: 'Comfort', desc: '只放你最爱、最常听的' },
  { value: 25, name: '偏熟悉', en: 'Cozy', desc: '收藏里没常听的 + 一点同艺人深挖' },
  { value: 50, name: '平衡', en: 'Balanced', desc: '一半熟，一半新' },
  { value: 75, name: '偏探索', en: 'Venture', desc: '大半没听过的，锚在你口味上' },
  { value: 100, name: '狂野', en: 'Wild', desc: '几乎全新，只留一点底色' },
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
  background: var(--panel);
  border-left: 1px solid var(--border);
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
.drawer-title {
  font-size: 12px;
  color: var(--accent);
  letter-spacing: 2px;
}
.close-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  width: 28px;
  height: 28px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.close-btn:hover { color: var(--accent); border-color: var(--accent-dim); }
.slider-group { display: flex; flex-direction: column; gap: 6px; }
.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text);
}
.val { color: var(--accent); font-weight: 500; }
.hint { font-size: 10px; color: var(--text-dim); }
.ticks { display: flex; justify-content: space-between; font-size: 8px; color: var(--text-dim); margin-top: 2px; letter-spacing: 0; }
.ticks .on { color: var(--accent); }
.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: #0a1024;
  border: 1px solid var(--border);
  outline: none;
  cursor: pointer;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: var(--accent);
  cursor: pointer;
  border: 1px solid var(--bg);
}
.slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--accent);
  cursor: pointer;
  border: 1px solid var(--bg);
  border-radius: 0;
}
.radio-group { display: flex; flex-direction: column; gap: 8px; }
.radio-row { display: flex; gap: 8px; }
.radio-btn {
  flex: 1;
  padding: 6px 0;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  cursor: pointer;
  letter-spacing: 1px;
  transition: all 0.15s;
}
.radio-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--blue-glow);
}
.radio-btn:hover:not(.active) {
  border-color: var(--accent-dim);
  color: var(--text);
}
.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
