<template>
  <div class="dj-log">
    <div class="log-body" ref="logBody" @scroll="onScroll">
      <div v-if="messages.length === 0 && !thinking" class="empty">
        Waiting for the DJ…
      </div>

      <div
        v-for="(msg, i) in messages"
        v-show="shouldRenderMessage(i, msg)"
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
            <span class="song-prefix">{{ msg.title }}</span> — {{ displayText(i, msg) }}
          </template>
          <template v-else-if="msg.kind === 'opening' || msg.kind === 'chat_reply'">{{ displayText(i, msg) }}</template>
          <template v-else-if="msg.kind === 'user'">{{ msg.text }}</template>
          <template v-else-if="msg.kind === 'stream'">{{ msg.text }}<span v-if="msg.id === streamingId" class="stream-caret">▍</span><span v-if="msg.stopped" class="stopped-tag"> — stopped</span></template>
          <template v-else-if="msg.kind === 'reaction'">
            <span class="reaction-text">reacted: {{ msg.text }}</span>
          </template>
          <template v-else>{{ msg.text }}</template>
        </div>
      </div>

      <div v-if="stats && (stats.vip_skipped > 0 || stats.not_found > 0)" class="log-msg system">
        <div class="msg-header">
          <span class="speaker system-label">SYSTEM</span>
          <span class="ts">{{ latestTs }}</span>
        </div>
        <div class="msg-body warn-text">
          {{ stats.vip_skipped }} unavailable, {{ stats.not_found }} not found (of {{ stats.total }} picked)
        </div>
      </div>

      <ThinkingIndicator :show="thinking" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted } from 'vue';
import ThinkingIndicator from './ThinkingIndicator.vue';

const props = defineProps({
  messages: Array,
  thinking: Boolean,
  stats: Object,
  streamingId: [String, Number],
});

const logBody = ref(null);

// --- Smart scroll ---
const userPinnedToBottom = ref(true);

function onScroll() {
  if (!logBody.value) return;
  const { scrollHeight, scrollTop, clientHeight } = logBody.value;
  userPinnedToBottom.value = (scrollHeight - scrollTop - clientHeight) < 60;
}

function maybeScrollToBottom() {
  if (!userPinnedToBottom.value) return;
  nextTick(() => {
    if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight;
  });
}

// --- Typewriter (串行队列:一条打完才下一条,像 ChatGPT 那样) ---
const TYPE_SPEED_MS = 18;
const typedTexts = ref(new Map()); // index → currently shown text(空字符串=排队中,未开始)
const typeQueue = []; // FIFO of {idx, fullText} pending
let typingActive = false;

function shouldRenderMessage(idx, msg) {
  // reaction / system 消息不参与排队,立即显示
  if (msg.kind === 'reaction' || msg.kind === 'system') return true;
  // chat_reply: participates in typewriter queue
  // (handled same as opening below)
  // 已经接管(在 typedTexts 里)的消息:有内容才显示;空字符串=排队中,先隐藏
  if (typedTexts.value.has(idx)) return typedTexts.value.get(idx).length > 0;
  // 历史消息(挂载前就在的)直接显示
  return true;
}

function enqueueTyping(idx, fullText) {
  typedTexts.value.set(idx, ''); // 占位:渲染时被 shouldRenderMessage 隐藏
  typeQueue.push({ idx, fullText });
  if (!typingActive) startNextTyping();
}

function startNextTyping() {
  const item = typeQueue.shift();
  if (!item) {
    typingActive = false;
    return;
  }
  typingActive = true;
  let i = 0;
  const tick = () => {
    i++;
    typedTexts.value.set(item.idx, item.fullText.slice(0, i));
    typedTexts.value = new Map(typedTexts.value); // 强制响应式
    maybeScrollToBottom();
    if (i < item.fullText.length) setTimeout(tick, TYPE_SPEED_MS);
    else startNextTyping();
  };
  tick();
}

function displayText(idx, msg) {
  if (typedTexts.value.has(idx)) return typedTexts.value.get(idx);
  return msg.text; // 历史消息直接全显示
}

// 新消息进来:加入队列,等前一条打完
watch(() => props.messages.length, (newLen, oldLen) => {
  const start = oldLen ?? 0;
  for (let i = start; i < newLen; i++) {
    const msg = props.messages[i];
    if (msg && (msg.kind === 'opening' || msg.kind === 'song' || msg.kind === 'chat_reply') && msg.text) {
      enqueueTyping(i, msg.text);
    }
  }
  maybeScrollToBottom();
});

// Scroll when thinking indicator changes
watch(() => props.thinking, () => {
  maybeScrollToBottom();
});

// Scroll as the streamed bubble grows (text changes, length stays same)
watch(() => props.messages[props.messages.length - 1]?.text, () => {
  maybeScrollToBottom();
});

// Update latestTs
const latestTs = ref('');
watch(() => props.messages, (msgs) => {
  if (msgs.length) latestTs.value = fmtTs(msgs[msgs.length - 1]?.ts);
}, { deep: true });

// On mount, treat all existing messages as already done (no animation for history)
onMounted(() => {
  // existing messages already have full text via msg.text fallback in displayText()
  maybeScrollToBottom();
});

function fmtTs(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return ''; }
}

function speakerLabel(msg) {
  if (msg.kind === 'user' || msg.kind === 'reaction') return 'YOU';
  if (msg.kind === 'system') return 'SYSTEM';
  return 'DJ';
}

function speakerClass(msg) {
  if (msg.kind === 'user') return 'speaker-user';
  if (msg.kind === 'reaction') return 'speaker-user';
  if (msg.kind === 'system') return 'system-label';
  if (msg.kind === 'chat_reply' || msg.kind === 'stream') return 'speaker-chat';
  return 'speaker-claude';
}

function msgSpeaker(msg) {
  if (msg.kind === 'user') return 'user-msg';
  if (msg.kind === 'reaction') return 'user-msg';
  if (msg.kind === 'system') return 'system-msg';
  return 'claude-msg';
}

function bodyClass(msg) {
  if (msg.kind === 'user') return 'user-body';
  if (msg.kind === 'reaction') return 'reaction-body';
  if (msg.kind === 'song') return 'song-body';
  if (msg.kind === 'system') return 'warn-text';
  if (msg.kind === 'chat_reply') return 'chat-reply-body';
  if (msg.kind === 'stream') return 'stream-body';
  return '';
}
</script>

<style scoped>
.dj-log {
  /* Borderless, transparent panel */
  padding: 0 4px;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.log-body {
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* 滚动条样式已全局统一(index.html) */
}

.log-msg { display: flex; flex-direction: column; gap: 3px; }
.msg-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.speaker {
  font-family: var(--font-sans);
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--paper-3);
}
.speaker-user { color: var(--paper-3); }
.speaker-chat, .speaker-claude { color: var(--paper-3); }
.system-label { color: var(--negative); }
.ts { font-family: var(--font-mono); font-size: 10px; color: var(--paper-4); opacity: 1; }
.msg-body {
  font-family: var(--font-serif);
  font-size: 15px;
  color: var(--paper-1);
  line-height: 1.9;
  white-space: pre-line;
}
.user-body, .reaction-body {
  /* 不用斜体:Noto Serif SC 无斜体字形,浏览器只能整体剪切倾斜方块字/假名/谚文,
     看着别扭。靠左侧 rule 边线 + 更淡的 paper-3 + 更小字号区分用户消息即可。 */
  font-style: normal;
  font-size: 14px;
  color: var(--paper-3);
  border-left: 2px solid var(--rule);
  padding-left: 10px;
}
.reaction-body { font-size: 12px; }
.song-body { color: var(--paper-1); }
.song-prefix { color: var(--paper-0); font-weight: 500; }
.chat-reply-body, .stream-body { color: var(--paper-1); }
.stream-caret { color: var(--gold); margin-left: 1px; animation: caretBlink 1s steps(1) infinite; }
.stopped-tag { font-family: var(--font-mono); font-size: 11px; color: var(--paper-4); font-style: normal; }
@keyframes caretBlink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
.warn-text { color: var(--negative); font-family: var(--font-mono); font-size: 12px; }
.empty { font-size: 13px; color: var(--paper-4); padding: 4px 0; font-family: var(--font-sans); }
</style>
