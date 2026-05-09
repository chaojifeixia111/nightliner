<template>
  <div class="dj-log-card">
    <div class="card-label">┌─ DJ LOG ─┐</div>

    <div class="log-body" ref="logBody">
      <div v-if="messages.length === 0 && !thinking" class="empty">
        ( 等 DJ 发话 )
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="log-msg"
        :class="msg.kind"
      >
        <div class="msg-header">
          <span class="speaker">:CLAUDE</span>
          <span class="ts">{{ fmtTs(msg.ts) }}</span>
        </div>
        <div class="msg-body">
          <template v-if="msg.kind === 'song'">
            <span class="song-prefix">▸ {{ msg.title }}:  </span>{{ msg.text }}
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtTs(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return ''; }
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
.dj-log-card {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 16px;
  margin-bottom: 12px;
}
.card-label {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 10px;
  letter-spacing: 1px;
}
.log-body {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.log-body::-webkit-scrollbar { width: 4px; }
.log-body::-webkit-scrollbar-track { background: transparent; }
.log-body::-webkit-scrollbar-thumb { background: var(--border); }
.empty { font-size: 12px; color: var(--text-dim); padding: 4px 0; }
.log-msg { display: flex; flex-direction: column; gap: 3px; }
.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.speaker {
  font-family: 'Press Start 2P', monospace;
  font-size: 7px;
  color: var(--text-dim);
  letter-spacing: 1px;
}
.system-label { color: var(--warn, #c8a03a); }
.ts { font-size: 10px; color: var(--text-dim); opacity: 0.6; }
.msg-body {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-line;
}
.log-msg.song .msg-body { color: var(--text-dim); }
.song-prefix { color: var(--accent); }
.log-msg.system .msg-body { color: var(--warn, #c8a03a); }
.warn-text { color: var(--warn, #c8a03a); }
</style>
