<template>
  <transition name="page">
    <div v-if="open" class="page-overlay">
      <div class="page-col">
        <div class="top-row">
          <div class="page-title">LISTEN NOW — TAP A COVER, IT PLAYS</div>
          <button class="ghost close" @click="$emit('close')" aria-label="Close">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div v-if="toast" class="toast">{{ toast }}</div>

        <div class="body">
          <div class="card-grid">
            <PlaylistCard v-for="c in cards" :key="c.level" :card="c" @play="onPlay" />
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue';
import Icon from './Icon.vue';
import PlaylistCard from './PlaylistCard.vue';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['close']);

const dailyCovers = ref([]);
const dailyCount = ref(0);
const toast = ref('');
let toastTimer = null;

const LEVELS = [
  { level: 'comfort',  value: 0,   kind: 'level', name: 'Comfort',  title: 'Comfort · 舒适区',  subtitle: 'Only your most-played' },
  { level: 'cozy',     value: 25,  kind: 'level', name: 'Cozy',     title: 'Cozy · 偏熟悉',     subtitle: 'Favorites, a little new' },
  { level: 'balanced', value: 50,  kind: 'level', name: 'Balanced', title: 'Balanced · 平衡',   subtitle: 'Half familiar, half new' },
  { level: 'venture',  value: 75,  kind: 'level', name: 'Venture',  title: 'Venture · 偏探索',  subtitle: 'Mostly new, still you' },
  { level: 'wild',     value: 100, kind: 'level', name: 'Wild',     title: 'Wild · 狂野',       subtitle: 'Almost all new' },
];

const cards = computed(() => [
  {
    level: 'daily', kind: 'daily', name: "Today's Picks", title: "Today's Picks",
    subtitle: dailyCount.value ? `${dailyCount.value} tracks · NetEase daily` : 'NetEase daily',
    covers: dailyCovers.value,
  },
  ...LEVELS,
]);

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('keydown', onKey);
    if (!dailyCovers.value.length) loadDailyCovers();
  } else {
    window.removeEventListener('keydown', onKey);
  }
});
onUnmounted(() => { window.removeEventListener('keydown', onKey); clearTimeout(toastTimer); });

function onKey(e) { if (e.key === 'Escape') emit('close'); }

async function loadDailyCovers() {
  try {
    const r = await fetch('/api/recommend').then(r => r.json());
    const songs = r.songs || [];
    dailyCount.value = songs.length;
    dailyCovers.value = songs.map(s => s.pic_url).filter(Boolean).slice(0, 4);
  } catch { /* 封面拿不到就用占位 */ }
}

function flashToast(msg) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 2500);
}

async function onPlay(card) {
  flashToast(`Starting ${card.name}…`);
  try {
    const r = await fetch('/api/listen', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: card.level }),
    }).then(r => r.json());
    if (!r.ok) flashToast("Couldn't build that playlist — try again.");
    else flashToast(`Playing ${card.name} · ${r.count} tracks`);
  } catch {
    flashToast("Couldn't reach the server — try again.");
  }
}
</script>

<style scoped>
.page-overlay { position: fixed; inset: 0; background: var(--ink-0); z-index: 300; }
.page-col { max-width: 720px; margin: 0 auto; height: 100%; padding: 0 16px; display: flex; flex-direction: column; }
.top-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 0 0; flex-shrink: 0; }
.page-title { font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px; color: var(--paper-3); }
.ghost {
  background: none; border: none; padding: 0; cursor: pointer; color: var(--paper-3);
  display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0;
  transition: color 0.18s;
}
.ghost:hover { color: var(--paper-0); }
.toast {
  font-family: var(--font-sans); font-size: 11px; letter-spacing: 0.5px; color: var(--gold);
  border: 1px solid var(--gold); border-radius: 2px; padding: 6px 10px; margin-top: 10px; flex-shrink: 0;
}
.body { flex: 1; overflow-y: auto; padding: 16px 0 24px; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.page-enter-active, .page-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.page-enter-from, .page-leave-to { opacity: 0; transform: translateY(16px); }
</style>
