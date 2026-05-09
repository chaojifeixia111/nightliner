<template>
  <div class="player">
    <div class="now" v-if="state.now">
      <div class="title">{{ state.now.title }}</div>
      <div class="artist">{{ state.now.artist }}</div>
      <div class="source">来源:网易云</div>
      <audio
        ref="audio"
        :src="state.now.url"
        autoplay
        controls
        @ended="onEnded"
        @timeupdate="onTimeUpdate"
      />
    </div>
    <div class="now empty" v-else>
      <p>(暂无播放,跟 DJ 聊几句开始)</p>
    </div>

    <SubtitleBar :text="state.subtitle" />

    <FeedbackButtons @feedback="$emit('feedback', $event)" />

    <QueuePreview :queue="state.queue" :now="state.now" />

    <ChatInput @send="$emit('chat', $event)" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import SubtitleBar from './SubtitleBar.vue';
import FeedbackButtons from './FeedbackButtons.vue';
import QueuePreview from './QueuePreview.vue';
import ChatInput from './ChatInput.vue';

const props = defineProps({ state: Object });
defineEmits(['feedback', 'chat']);

const audio = ref(null);
let lastReportedSec = 0;

function onTimeUpdate() {
  if (!audio.value) return;
  lastReportedSec = Math.floor(audio.value.currentTime);
}

function onEnded() {
  reportPlayEvent('natural', Math.floor(audio.value?.duration || 0));
}

// 用户点 ⏭ 或换歌时的"被打断"信号:audio src 变化 → 旧的 audio 被销毁,这里用 watch
import { watch } from 'vue';
watch(() => props.state.now?.title, (newTitle, oldTitle) => {
  if (oldTitle && oldTitle !== newTitle && lastReportedSec > 0) {
    // 旧歌没播完就换了,记一笔 user_skip
    fetch('/api/play-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: oldTitle,
        artist: props.state.now?.artist || '',
        duration_sec: Math.floor(audio.value?.duration || 0),
        played_sec: lastReportedSec,
        ended_reason: 'user_skip',
      }),
    });
    lastReportedSec = 0;
  }
});

function reportPlayEvent(reason, playedSec) {
  if (!props.state.now) return;
  fetch('/api/play-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: props.state.now.title,
      artist: props.state.now.artist,
      duration_sec: Math.floor(audio.value?.duration || 0),
      played_sec: playedSec,
      ended_reason: reason,
    }),
  });
}
</script>

<style scoped>
.player { padding: 12px 0; }
.now { text-align: center; margin: 24px 0; }
.title { font-size: 24px; font-weight: 600; margin-bottom: 4px; }
.artist { color: #999; margin-bottom: 8px; }
.source { color: #555; font-size: 12px; margin-bottom: 16px; }
.empty { color: #555; padding: 40px 0; }
audio { width: 100%; max-width: 480px; }
</style>
