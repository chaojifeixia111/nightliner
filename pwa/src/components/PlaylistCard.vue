<template>
  <div class="pl-card" :style="{ background: bg }" @click="$emit('play', card)" :title="`Play ${card.title}`">
    <span class="kick">{{ kick.label }} · <b>{{ kick.val }}</b></span>
    <span class="name">{{ card.title }}</span>
    <!-- level: 金色刻度(填充 = 探索度);daily: 整宽金线 -->
    <span v-if="card.kind === 'level'" class="bar">
      <span class="fill" :style="{ width: card.value + '%' }"></span>
      <span class="knob" :style="{ left: card.value + '%' }"></span>
    </span>
    <span v-else class="solid"></span>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ card: Object });
defineEmits(['play']);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
// 探索度越高底色越暖(极淡),辅助读能量
const BG = { 0: '#141210', 25: '#17130d', 50: '#1a150c', 75: '#1d160b', 100: '#20180a' };

const bg = computed(() => props.card.kind === 'daily' ? '#141210' : (BG[props.card.value] ?? '#141210'));
const kick = computed(() => {
  if (props.card.kind === 'daily') {
    const d = new Date();
    return { label: 'TODAY', val: `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}` };
  }
  return { label: 'EXPLORE', val: String(props.card.value).padStart(2, '0') };
});
</script>

<style scoped>
.pl-card {
  position: relative; aspect-ratio: 1;
  border: 1px solid var(--ink-2); border-radius: 8px; overflow: hidden;
  cursor: pointer; transition: border-color 0.18s;
}
.pl-card:hover { border-color: var(--rule); }

.kick {
  position: absolute; top: 11px; left: 12px;
  font-family: var(--font-sans); font-size: 9px; letter-spacing: 1.5px; color: var(--paper-4);
}
.kick b { color: var(--gold); font-weight: 400; }

.name {
  position: absolute; bottom: 26px; left: 12px; right: 12px;
  font-family: var(--font-serif); font-size: 21px; color: var(--paper-0); line-height: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.bar {
  position: absolute; bottom: 15px; left: 12px; right: 12px; height: 3px;
  background: var(--ink-2); border-radius: 2px;
}
.fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--gold); border-radius: 2px; }
.knob {
  position: absolute; top: 50%; width: 7px; height: 7px; border-radius: 50%;
  background: var(--paper-0); transform: translate(-50%, -50%);
}
.solid {
  position: absolute; bottom: 15px; left: 12px; right: 12px; height: 2px;
  background: var(--gold); border-radius: 2px;
}
</style>
