<template>
  <form class="chat-pill" :class="{ focused, busy }" @submit.prevent="onSubmit">
    <input
      ref="inputEl"
      v-model="text"
      :placeholder="busy ? 'DJ 正在回应…' : placeholder"
      :disabled="busy"
      autocomplete="off"
      @focus="focused = true"
      @blur="focused = false"
    />
    <button type="submit" class="send-btn" :disabled="!text.trim() || busy" aria-label="发送">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5" />
        <path d="M6 11l6-6 6 6" />
      </svg>
    </button>
  </form>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { pickGreeting } from '../utils/greetings.js';

const text = ref('');
const focused = ref(false);
const placeholder = ref('');
const inputEl = ref(null);
const emit = defineEmits(['send', 'command']);
const props = defineProps({ busy: Boolean });

onMounted(() => {
  placeholder.value = pickGreeting();
});

function onSubmit() {
  const msg = text.value.trim();
  if (!msg || props.busy) return;

  // Slash commands — handle locally, don't send to LLM
  if (msg.startsWith('/')) {
    const [cmd, ...args] = msg.slice(1).split(/\s+/);
    emit('command', { cmd: cmd.toLowerCase(), args });
  } else {
    emit('send', msg);
  }

  text.value = '';
  // Refresh greeting on next focus
  placeholder.value = pickGreeting();
}
</script>

<style scoped>
.chat-pill {
  display: flex;
  align-items: center;
  height: 48px;
  border-radius: 24px;
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 4px 4px 4px 16px;
  transition: border-color 0.15s, box-shadow 0.15s;
  flex-shrink: 0;
}
.chat-pill.focused {
  border-color: var(--blue);
  box-shadow: 0 0 12px var(--blue-glow);
}
input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  outline: none;
  padding: 0;
  min-width: 0;
}
input::placeholder { color: var(--text-dim); }

.send-btn {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: var(--bg);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s;
  font-family: 'JetBrains Mono', monospace;
}
.send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.send-btn:hover:not(:disabled) {
  opacity: 0.85;
}
</style>
