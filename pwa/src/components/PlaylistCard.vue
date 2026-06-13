<template>
  <div class="pl-card" @click="$emit('play', card)" :title="`Play ${card.name || card.title}`">
    <div class="pl-cover" :class="card.kind">
      <!-- daily: 2×2 封面拼贴 -->
      <div v-if="card.kind === 'daily'" class="collage">
        <span v-for="(u, i) in coverTiles" :key="i" :style="u ? { backgroundImage: `url(${u})` } : null"></span>
      </div>
      <!-- level: 探索刻度母题 -->
      <template v-else>
        <span class="ex-kick">EXPLORE · {{ card.value }}</span>
        <span class="ex-name">{{ card.name }}</span>
        <span class="ex-track"><span class="ex-fill" :style="{ width: card.value + '%' }"></span><span class="ex-knob" :style="{ left: card.value + '%' }"></span></span>
      </template>
      <button class="pl-play" @click.stop="$emit('play', card)" :aria-label="`Play ${card.name || card.title}`">
        <Icon name="play" :size="13" />
      </button>
    </div>
    <div class="pl-title">{{ card.title }}</div>
    <div class="pl-sub">{{ card.subtitle }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({ card: Object });
defineEmits(['play']);

// 拼贴固定 4 格,封面不足用空格占位
const coverTiles = computed(() => {
  const c = props.card.covers || [];
  return [c[0] || null, c[1] || null, c[2] || null, c[3] || null];
});
</script>

<style scoped>
.pl-card { cursor: pointer; min-width: 0; }
.pl-cover {
  position: relative; aspect-ratio: 1;
  border: 1px solid var(--ink-2); border-radius: 8px; overflow: hidden;
  background: var(--ink-1); transition: border-color 0.18s;
}
.pl-card:hover .pl-cover { border-color: var(--rule); }

.collage { display: grid; grid-template-columns: 1fr 1fr; width: 100%; height: 100%; }
.collage span { background-size: cover; background-position: center; background-color: #221a10; }

.pl-cover.level { background: #16130d; }
.ex-kick {
  position: absolute; left: 10px; top: 10px;
  font-family: var(--font-sans); font-size: 9px; letter-spacing: 1.5px; color: var(--paper-4);
}
.ex-name {
  position: absolute; left: 11px; bottom: 28px;
  font-family: var(--font-serif); font-size: 19px; color: var(--paper-0);
}
.ex-track {
  position: absolute; left: 11px; right: 11px; bottom: 16px;
  height: 3px; background: var(--ink-2); border-radius: 2px;
}
.ex-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--gold); border-radius: 2px; }
.ex-knob {
  position: absolute; top: 50%; width: 7px; height: 7px; border-radius: 50%;
  background: var(--paper-0); transform: translate(-50%, -50%);
}

.pl-play {
  position: absolute; right: 9px; bottom: 9px;
  width: 24px; height: 24px; border-radius: 50%;
  border: 1px solid var(--gold); background: rgba(19, 17, 16, 0.7);
  color: var(--gold); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.18s, color 0.18s;
}
.pl-play:hover { background: var(--gold); color: var(--ink-0); }

.pl-title {
  font-family: var(--font-serif); font-size: 13px; color: var(--paper-1);
  margin-top: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pl-sub {
  font-family: var(--font-sans); font-size: 11px; color: var(--paper-4);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
