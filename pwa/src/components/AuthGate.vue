<template>
  <div class="gate-backdrop">
    <form class="gate-card" @submit.prevent="submit">
      <div class="gate-title">夜线电台</div>
      <div class="gate-sub">请输入访问口令</div>
      <input
        ref="inp"
        v-model="value"
        type="password"
        class="gate-input"
        placeholder="口令"
        autocomplete="current-password"
      />
      <button type="submit" class="gate-btn" :disabled="!value">进入</button>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
const emit = defineEmits(['submit']);
const value = ref('');
const inp = ref(null);
onMounted(() => inp.value?.focus());
function submit() {
  if (value.value) emit('submit', value.value);
}
</script>

<style scoped>
.gate-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  background: var(--ink-0);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.gate-card {
  display: flex; flex-direction: column; gap: 14px;
  width: 100%; max-width: 280px;
}
.gate-title {
  font-family: var(--font-serif); font-size: 22px; color: var(--paper-0);
  letter-spacing: 2px; text-align: center;
}
.gate-sub {
  font-family: var(--font-serif); font-size: 13px; color: var(--paper-3);
  text-align: center; margin-top: -6px;
}
.gate-input {
  background: transparent; border: 1px solid var(--ink-2);
  border-radius: 2px; padding: 10px 12px;
  color: var(--paper-1); font-family: var(--font-sans); font-size: 15px;
  outline: none;
}
.gate-input:focus { border-color: var(--gold); }
.gate-btn {
  background: transparent; border: 1px solid var(--gold);
  border-radius: 2px; padding: 9px; color: var(--gold);
  font-family: var(--font-serif); font-size: 14px; letter-spacing: 2px;
  cursor: pointer;
}
.gate-btn:hover:not(:disabled) { background: var(--gold); color: var(--ink-0); }
.gate-btn:disabled { opacity: 0.4; cursor: default; }
</style>
