<template>
  <form class="chat-pill" :class="{ focused, busy }" @submit.prevent="onSubmit">
    <button type="button" class="search-btn" @click="onSearch" aria-label="Search">
      <Icon name="search" :size="15" />
    </button>
    <input
      ref="inputEl"
      v-model="text"
      :placeholder="busy ? 'DJ is on it…' : placeholder"
      :disabled="busy"
      autocomplete="off"
      @focus="focused = true"
      @blur="focused = false"
    />
    <button v-if="busy" type="button" class="stop-btn" @click="$emit('stop')" aria-label="Stop">
      <Icon name="square" :size="12" />
    </button>
    <button v-else type="submit" class="send-btn" :disabled="!text.trim()" aria-label="Send">
      <Icon name="arrow-up" :size="15" />
    </button>
  </form>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { pickGreeting } from '../utils/greetings.js';
import Icon from './Icon.vue';

const text = ref('');
const focused = ref(false);
const placeholder = ref('');
const inputEl = ref(null);
const emit = defineEmits(['send', 'command', 'open-search', 'stop']);
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

// 放大镜:把输入框里已经打好的字直接带进搜索页(空则打开空搜索)
function onSearch() {
  emit('open-search', text.value.trim());
  text.value = '';
}
</script>

<style scoped>
.chat-pill {
  display: flex;
  align-items: center;
  height: 52px;
  border: none;
  border-top: 1px solid var(--ink-2);
  border-radius: 0;
  background: transparent;
  padding: 8px 4px;
  flex-shrink: 0;
}
input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--paper-1);
  font-family: var(--font-serif);
  font-size: 14px;
  outline: none;
  padding: 0;
  min-width: 0;
}
input::placeholder { color: var(--paper-4); }
.search-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--paper-4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.18s;
}
.search-btn:hover { color: var(--paper-1); }
.send-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--gold);
  background: transparent;
  color: var(--gold);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.18s, color 0.18s, opacity 0.18s;
}
.send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.send-btn:hover:not(:disabled) { background: var(--gold); color: var(--ink-0); }
.stop-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--paper-4);
  background: transparent;
  color: var(--paper-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.18s, color 0.18s, border-color 0.18s;
}
.stop-btn:hover { border-color: var(--paper-1); color: var(--paper-0); }
</style>
