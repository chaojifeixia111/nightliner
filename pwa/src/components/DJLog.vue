<template>
  <div class="dj-log">
    <div class="log-body" ref="logBody">
      <div v-if="messages.length === 0 && !thinking" class="empty">
        (waiting for DJ...)
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="log-msg"
        :class="[msg.kind, msgSpeaker(msg)]"
      >
        <div class="msg-header">
          <span class="speaker" :class="speakerClass(msg)">{{ speakerLabel(msg) }}</span>
          <span class="ts">{{ fmtTs(msg.ts) }}</span>
        </div>
        <div class="msg-body" :class="bodyClass(msg)">
          <template v-if="msg.kind === 'song'">
            <span class="song-prefix">▸ {{ msg.title }}: </span>{{ msg.text }}
          </template>
          <template v-else-if="msg.kind === 'opening'">
            <span class="cli-prompt">&gt; </span>{{ msg.text }}
          </template>
          <template v-else-if="msg.kind === 'reaction'">
            <span class="reaction-text">reacted: {{ msg.text }}</span>
          </template>
          <template v-else>{{ msg.text }}</template>
        </div>
      </div>

      <div v-if="stats && (stats.vip_skipped > 0 || stats.not_found > 0)" class="log-msg system">
        <div class="msg-header">
          <span class="speaker system-label">:SYSTEM</span>
          <span class="ts">{{ latestTs }}</span>
        </div>
        <div class="msg-body warn-text">
          ⚠ {{ stats.vip_skipped }} 首仅 VIP 可播，{{ stats.not_found }} 首未找到 (共 {{ stats.total }} 首推荐)
        </div>
      </div>

      <ThinkingIndicator :show="thinking" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
import ThinkingIndicator from './ThinkingIndicator.vue';

const props = defineProps({
  messages: Array,
  thinking: Boolean,
  stats: Object,
});

const logBody = ref(null);

function fmtTs(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return ''; }
}

function speakerLabel(msg) {
  if (msg.kind === 'reaction') return ':USER';
  return ':CLAUDE';
}

function speakerClass(msg) {
  if (msg.kind === 'reaction') return 'speaker-user';
  return 'speaker-claude';
}

function msgSpeaker(msg) {
  if (msg.kind === 'reaction') return 'user-msg';
  return 'claude-msg';
}

function bodyClass(msg) {
  if (msg.kind === 'reaction') return 'reaction-body';
  if (msg.kind === 'song') return 'song-body';
  return '';
}

const latestTs = ref('');
watch(() => props.messages, (msgs) => {
  if (msgs.length) latestTs.value = fmtTs(msgs[msgs.length - 1]?.ts);
  nextTick(() => {
    if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight;
  });
}, { deep: true });

watch(() => props.thinking, () => {
  nextTick(() => {
    if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight;
  });
});
</script>

<style scoped>
.dj-log {
  /* Borderless, transparent panel */
  padding: 0 4px;
}
.log-body {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--blue) transparent;
}
.log-body::-webkit-scrollbar { width: 8px; }
.log-body::-webkit-scrollbar-track { background: transparent; }
.log-body::-webkit-scrollbar-thumb {
  background: var(--blue-dim);
  border-radius: 4px;
}
.log-body::-webkit-scrollbar-thumb:hover { background: var(--blue); }

.empty {
  font-size: 12px;
  color: var(--text-dim);
  padding: 4px 0;
}
.log-msg { display: flex; flex-direction: column; gap: 3px; }
.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.speaker {
  font-family: 'Press Start 2P', monospace;
  font-size: 8px;
  letter-spacing: 1px;
}
.speaker-claude { color: var(--text-dim); }
.speaker-user { color: var(--blue); }
.system-label { color: var(--warn); }
.ts {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--text-dim);
  opacity: 0.6;
}
.msg-body {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-line;
}
.song-body { color: var(--text-dim); }
.reaction-body {
  font-size: 12px;
  color: var(--blue);
  opacity: 0.85;
}
.cli-prompt { color: var(--text-dim); }
.song-prefix { color: var(--accent); }
.warn-text { color: var(--warn); }
</style>
