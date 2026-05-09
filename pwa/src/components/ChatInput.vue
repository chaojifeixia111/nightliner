<template>
  <form class="chat" @submit.prevent="onSubmit">
    <input
      v-model="text"
      placeholder="跟 DJ 说话…"
      autocomplete="off"
    />
    <button type="submit" :disabled="!text.trim()">发送</button>
  </form>
</template>

<script setup>
import { ref } from 'vue';
const text = ref('');
const emit = defineEmits(['send']);

function onSubmit() {
  const msg = text.value.trim();
  if (!msg) return;
  emit('send', msg);
  text.value = '';
}
</script>

<style scoped>
.chat {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
input {
  flex: 1;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
input:focus { border-color: var(--accent-dim); }
input::placeholder { color: var(--text-dim); }
button {
  padding: 10px 20px;
  background: var(--accent-dim);
  border: 1px solid var(--accent-dim);
  color: var(--bg);
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
  transition: background 0.15s;
}
button:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); }
button:disabled {
  background: var(--panel);
  border-color: var(--border);
  color: var(--text-dim);
  cursor: not-allowed;
}
</style>
