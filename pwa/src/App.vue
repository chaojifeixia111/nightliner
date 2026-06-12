<template>
  <div class="app-shell">
    <AppHeader
      :connected="connected" :playing="playing"
      @open-tuning="tuningOpen = true"
      @open-queue="queueOpen = true"
      @open-daily="openDiscover('daily')"
      @open-search="openDiscover('search')"
    />
    <HeroCard
      :state="state"
      @feedback="onFeedback"
      @skip="onSkip"
      @previous="onPrevious"
      @user-message="pushDjMessage"
      @playing-change="playing = $event"
    />
    <div class="djlog-wrap">
      <DJLog :messages="djMessages" :thinking="thinking" :stats="lastStats" :streaming-id="streamingId" />
    </div>
    <ChatInput :busy="thinking" @send="onChat" @command="onCommand" />
    <TuningDrawer
      :open="tuningOpen"
      :tuning="state.tuning"
      @close="tuningOpen = false"
      @change="onTuningChange"
    />
    <QueueDrawer
      :open="queueOpen"
      :queue="state.queue"
      :now="state.now"
      @close="queueOpen = false"
    />
    <DiscoverPage
      :open="discoverOpen"
      :variant="discoverVariant"
      :now="state.now"
      @close="discoverOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import AppHeader from './components/AppHeader.vue';
import HeroCard from './components/HeroCard.vue';
import DJLog from './components/DJLog.vue';
import ChatInput from './components/ChatInput.vue';
import TuningDrawer from './components/TuningDrawer.vue';
import QueueDrawer from './components/QueueDrawer.vue';
import DiscoverPage from './components/DiscoverPage.vue';
import { connectWs, sendFeedback } from './ws-client.js';

const connected = ref(false);
const tuningOpen = ref(false);
const queueOpen = ref(false);
const discoverOpen = ref(false);
const discoverVariant = ref('daily');   // 'daily' | 'search'

function openDiscover(variant) {
  discoverVariant.value = variant;
  discoverOpen.value = true;
}
const thinking = ref(false);
const playing = ref(false);
const djMessages = ref([]);
const lastStats = ref(null);
const streamingId = ref(null);

const state = reactive({
  now: null,
  queue: [],
  tuning: { exploration_pct: 30, queue_length: 10 },
});

let ws;

const MSG_CAP = 30;

function pushDjMessage(msg) {
  djMessages.value.push(msg);
  if (djMessages.value.length > MSG_CAP) {
    djMessages.value.splice(0, djMessages.value.length - MSG_CAP);
  }
}

// --- Streaming DJ reply (token-by-token) ---
function startStream({ id, ts }) {
  thinking.value = false; // DJ 开口了,收起"正在选歌"
  streamingId.value = id;
  pushDjMessage({ ts: ts || new Date().toISOString(), kind: 'stream', id, text: '' });
}
function appendStream({ id, delta }) {
  const m = djMessages.value.find(x => x.id === id);
  if (m) {
    m.text += delta;
  } else {
    // start 事件没收到(或被 cap 挤掉):兜底新建
    thinking.value = false;
    streamingId.value = id;
    pushDjMessage({ ts: new Date().toISOString(), kind: 'stream', id, text: delta });
  }
}
function endStream({ id, say }) {
  const m = djMessages.value.find(x => x.id === id);
  if (m) {
    if (say) m.text = say; // 用服务端的权威 say 收尾(去掉流式尾部杂质)
    else if (!m.text) {
      const idx = djMessages.value.findIndex(x => x.id === id);
      if (idx >= 0) djMessages.value.splice(idx, 1); // 空 say → 丢掉占位泡
    }
  }
  if (streamingId.value === id) streamingId.value = null;
}

onMounted(() => {
  ws = connectWs((msg) => {
    if (msg.type === 'connected') connected.value = true;
    if (msg.type === 'disconnected') connected.value = false;
    if (msg.type === 'now') state.now = msg.data;
    if (msg.type === 'queue') state.queue = msg.data;
    if (msg.type === 'tuning') Object.assign(state.tuning, msg.data);
    if (msg.type === 'thinking') thinking.value = msg.data;
    if (msg.type === 'dj_message') pushDjMessage(msg.data);
    if (msg.type === 'stats') lastStats.value = msg.data;
    if (msg.type === 'dj_stream_start') startStream(msg.data);
    if (msg.type === 'dj_stream_delta') appendStream(msg.data);
    if (msg.type === 'dj_stream_end') endStream(msg.data);
  });

  // Fetch initial tuning
  fetch('/api/tuning').then(r => r.json()).then(t => Object.assign(state.tuning, t)).catch(() => {});
});

onUnmounted(() => ws?.close());

function onFeedback(payload) {
  // backward compat: support string OR object
  const { signal, reason } = typeof payload === 'string'
    ? { signal: payload, reason: null }
    : payload;
  if (state.now) sendFeedback({ ...state.now, signal, reason });
}

function onChat(text) {
  // Echo the user's message immediately so the send is visibly acknowledged
  pushDjMessage({ ts: new Date().toISOString(), kind: 'user', text });
  // Show the thinking state right away, without waiting for the WS round-trip
  thinking.value = true;
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  }).catch(() => {
    thinking.value = false;
    pushDjMessage({ ts: new Date().toISOString(), kind: 'system', text: 'Send failed — is the backend running?' });
  });
}

function onSkip() {
  if (!state.now) return;
  fetch('/api/skip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: state.now.title, artist: state.now.artist }),
  });
}

function onPrevious() {
  fetch('/api/previous', { method: 'POST' }).catch(() => {});
}

// 滑杆即时生效:拖动/点击后防抖上报,抽屉不关闭,可继续微调
function onTuningChange(newTuning) {
  fetch('/api/tuning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newTuning),
  }).catch(() => {});
}

// CLI 风格斜杠命令(本地处理,不发给 LLM)
function onCommand({ cmd, args }) {
  const ts = new Date().toISOString();
  switch (cmd) {
    case 'clear':
    case 'cls':
      djMessages.value = [];
      lastStats.value = null;
      break;
    case 'help':
    case '?':
      pushDjMessage({
        ts, kind: 'system',
        text: '/clear          清空对话\n/help /?        显示命令\n/daily          打开每日推荐\n/search         打开搜索\n/tuning         打开调音台\n/queue          打开队列\n/anti           查看 anti-list\n/cooldown       查看 cooldown 列表\n/history        查看最近对话历史\n/stats          查看反馈统计',
      });
      break;
    case 'tuning':
      tuningOpen.value = true;
      break;
    case 'queue':
      queueOpen.value = true;
      break;
    case 'daily':
      openDiscover('daily');
      break;
    case 'search':
      openDiscover('search');
      break;
    case 'anti':
    case 'antilist':
      fetch('/api/state/anti').then(r => r.json()).then(items => {
        const lines = items.length
          ? items.map(s => `${s.song_title} / ${s.song_artist}`).join('\n')
          : '(空)';
        pushDjMessage({ ts: new Date().toISOString(), kind: 'system',
          text: `Anti-list (${items.length} 条):\n${lines}` });
      }).catch(e => pushDjMessage({ ts: new Date().toISOString(), kind: 'system', text: `错误: ${e.message}` }));
      break;
    case 'cooldown':
      fetch('/api/state/cooldown').then(r => r.json()).then(items => {
        const lines = items.length
          ? items.map(s => `${s.song_title} / ${s.song_artist} (until ${new Date(s.cooldown_until * 1000).toLocaleDateString()})`).join('\n')
          : '(空)';
        pushDjMessage({ ts: new Date().toISOString(), kind: 'system',
          text: `Cooldown (${items.length} 条):\n${lines}` });
      }).catch(e => pushDjMessage({ ts: new Date().toISOString(), kind: 'system', text: `错误: ${e.message}` }));
      break;
    case 'history':
      fetch('/api/state/history').then(r => r.json()).then(items => {
        const lines = items.length
          ? items.map(t => `[${new Date(t.ts * 1000).toLocaleTimeString()}] ${t.intent}: "${(t.user_message || '').slice(0, 40)}" → ${(t.dj_say || '').slice(0, 50)}`).join('\n')
          : '(空)';
        pushDjMessage({ ts: new Date().toISOString(), kind: 'system',
          text: `最近对话 (${items.length} 条):\n${lines}` });
      }).catch(e => pushDjMessage({ ts: new Date().toISOString(), kind: 'system', text: `错误: ${e.message}` }));
      break;
    case 'stats':
      fetch('/api/state/stats').then(r => r.json()).then(s => {
        pushDjMessage({ ts: new Date().toISOString(), kind: 'system',
          text: `love: ${s.love || 0}\nwrong_vibe: ${s.wrong_vibe || 0}\ntoo_familiar: ${s.too_familiar || 0}\nnever_again: ${s.never_again || 0}\nplay events: ${s.play_events || 0}\nchat turns: ${s.chat_turns || 0}` });
      }).catch(e => pushDjMessage({ ts: new Date().toISOString(), kind: 'system', text: `错误: ${e.message}` }));
      break;
    default:
      pushDjMessage({
        ts, kind: 'system',
        text: `unknown command: /${cmd} (try /help)`,
      });
  }
}
</script>

<style scoped>
.app-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  padding-bottom: 8px;
  min-height: 0;              /* 允许 flex children 收缩,让 DJLog 内部滚 */
}

.djlog-wrap {
  flex: 1;
  min-height: 0;              /* 关键:让 DJLog 在剩余空间内滚动,不撑爆父容器 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
