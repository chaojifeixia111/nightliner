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
    <DJLog :messages="djMessages" :thinking="thinking" :stats="lastStats" />
    <ChatInput @send="onChat" />
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
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  min-height: calc(100vh - 28px);
}
</style>
