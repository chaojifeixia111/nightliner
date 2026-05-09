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
.chat { display: flex; gap: 8px; margin-top: 16px; }
input {
  flex: 1;
  padding: 12px;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
}
input:focus { outline: none; border-color: #555; }
button {
  padding: 12px 24px;
  background: #2a4a8a;
  border: none;
  color: #fff;
  border-radius: 8px;
  cursor: pointer;
}
button:disabled { background: #333; color: #666; cursor: not-allowed; }
</style>
