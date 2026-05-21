<template>
  <div class="app-shell">
    <AppHeader @open-tuning="tuningOpen = true" @open-queue="queueOpen = true" />
    <HeroCard
      :state="state"
      @feedback="onFeedback"
      @skip="onSkip"
      @previous="onPrevious"
      @user-message="pushDjMessage"
    />
    <div class="djlog-wrap">
      <DJLog :messages="djMessages" :thinking="thinking" :stats="lastStats" />
    </div>
    <ChatInput @send="onChat" @command="onCommand" />
    <StatusBar :connected="connected" />
    <TuningDrawer
      :open="tuningOpen"
      :tuning="state.tuning"
      @close="tuningOpen = false"
      @apply="onApplyTuning"
    />
    <QueueDrawer
      :open="queueOpen"
      :queue="state.queue"
      :now="state.now"
      @close="queueOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import AppHeader from './components/AppHeader.vue';
import HeroCard from './components/HeroCard.vue';
import DJLog from './components/DJLog.vue';
import ChatInput from './components/ChatInput.vue';
import StatusBar from './components/StatusBar.vue';
import TuningDrawer from './components/TuningDrawer.vue';
import QueueDrawer from './components/QueueDrawer.vue';
import { connectWs, sendFeedback } from './ws-client.js';

const connected = ref(false);
const tuningOpen = ref(false);
const queueOpen = ref(false);
const thinking = ref(false);
const djMessages = ref([]);
const lastStats = ref(null);

const state = reactive({
  now: null,
  queue: [],
  tuning: { exploration_pct: 30, queue_length: 10, chattiness: 'medium' },
});

let ws;

const MSG_CAP = 30;

function pushDjMessage(msg) {
  djMessages.value.push(msg);
  if (djMessages.value.length > MSG_CAP) {
    djMessages.value.splice(0, djMessages.value.length - MSG_CAP);
  }
}

onMounted(() => {
  ws = connectWs((msg) => {
    if (msg.type === 'connected') connected.value = true;
    if (msg.type === 'now') state.now = msg.data;
    if (msg.type === 'queue') state.queue = msg.data;
    if (msg.type === 'tuning') Object.assign(state.tuning, msg.data);
    if (msg.type === 'thinking') thinking.value = msg.data;
    if (msg.type === 'dj_message') pushDjMessage(msg.data);
    if (msg.type === 'stats') lastStats.value = msg.data;
  });

  // Fetch initial tuning
  fetch('/api/tuning').then(r => r.json()).then(t => Object.assign(state.tuning, t)).catch(() => {});
});

onUnmounted(() => ws?.close());

function onFeedback(signal) {
  if (state.now) sendFeedback({ ...state.now, signal });
}

function onChat(text) {
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
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

function onApplyTuning(newTuning) {
  fetch('/api/tuning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newTuning),
  });
  tuningOpen.value = false;
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
        text: '/clear          清空对话\n/help /?        显示命令\n/tuning         打开调音台\n/queue          打开队列\n/anti           查看 anti-list\n/cooldown       查看 cooldown 列表\n/history        查看最近对话历史\n/stats          查看反馈统计',
      });
      break;
    case 'tuning':
      tuningOpen.value = true;
      break;
    case 'queue':
      queueOpen.value = true;
      break;
    case 'anti':
    case 'antilist':
      fetch('/api/state/anti').then(r => r.json()).then(items => {
        const lines = items.length
          ? items.map(s => `🚫 ${s.song_title} / ${s.song_artist}`).join('\n')
          : '(空)';
        pushDjMessage({ ts: new Date().toISOString(), kind: 'system',
          text: `Anti-list (${items.length} 条):\n${lines}` });
      }).catch(e => pushDjMessage({ ts: new Date().toISOString(), kind: 'system', text: `错误: ${e.message}` }));
      break;
    case 'cooldown':
      fetch('/api/state/cooldown').then(r => r.json()).then(items => {
        const lines = items.length
          ? items.map(s => `🔁 ${s.song_title} / ${s.song_artist} (until ${new Date(s.cooldown_until * 1000).toLocaleDateString()})`).join('\n')
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
          text: `❤ love: ${s.love || 0}\n✗ wrong_vibe: ${s.wrong_vibe || 0}\n🔁 too_familiar: ${s.too_familiar || 0}\n🚫 never_again: ${s.never_again || 0}\nplay events: ${s.play_events || 0}\nchat turns: ${s.chat_turns || 0}` });
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
  padding-bottom: 36px;       /* 给底部固定的 StatusBar(28px)留位置,留 8px 缓冲 */
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
