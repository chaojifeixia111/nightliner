<template>
  <div class="player-shell">
    <h1>Nightliner</h1>
    <p v-if="!connected">连接中...</p>
    <Player v-else :state="state" @feedback="onFeedback" @chat="onChat" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import Player from './components/Player.vue';
import { connectWs, sendChat, sendFeedback } from './ws-client.js';

const connected = ref(false);
const state = ref({ now: null, queue: [], subtitle: '' });

let ws;

onMounted(() => {
  ws = connectWs((msg) => {
    if (msg.type === 'now') state.value.now = msg.data;
    if (msg.type === 'queue') state.value.queue = msg.data;
    if (msg.type === 'subtitle') state.value.subtitle = msg.data;
    if (msg.type === 'connected') connected.value = true;
  });
});

onUnmounted(() => ws?.close());

function onFeedback(signal) {
  if (state.value.now) sendFeedback({ ...state.value.now, signal });
}

function onChat(text) {
  sendChat(text);
}
</script>
