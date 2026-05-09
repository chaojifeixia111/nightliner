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
            <span>探索系数</span>
            <span class="val">{{ local.exploration_pct }}%</span>
          </label>
          <input
            type="range"
            min="0" max="100" step="5"
            v-model.number="local.exploration_pct"
            class="slider"
          />
          <div class="hint">library : recommend : wildcard ≈ {{ libPct }} : {{ recPct }} : {{ wildPct }}</div>
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

        <button class="apply-btn" @click="onApply">应用</button>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { reactive, watch, computed } from 'vue';

const props = defineProps({ open: Boolean, tuning: Object });
const emit = defineEmits(['close', 'apply']);

const local = reactive({
  exploration_pct: 30,
  queue_length: 10,
  chattiness: 'medium',
});

watch(() => props.open, (v) => {
  if (v && props.tuning) Object.assign(local, props.tuning);
});

const libPct = computed(() => Math.round(100 - local.exploration_pct));
const recPct = computed(() => Math.round(local.exploration_pct * 0.7));
const wildPct = computed(() => Math.round(local.exploration_pct * 0.3));

function onApply() {
  emit('apply', { ...local });
}
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
.apply-btn {
  margin-top: auto;
  padding: 12px;
  background: var(--accent);
  border: none;
  color: var(--bg);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 1px;
  transition: opacity 0.15s;
}
.apply-btn:hover { opacity: 0.85; }

.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
