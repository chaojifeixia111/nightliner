<template>
  <transition name="page">
    <div v-if="open" class="page-overlay">
      <div class="page-col">
        <div class="top-row">
          <div v-if="variant === 'search'" class="search-bar" :class="{ active: query.trim() }">
            <Icon name="search" :size="15" class="search-ic" />
            <input ref="box" v-model="query" placeholder="Search songs or artists…" />
            <button v-if="query" class="ghost" @click="query = ''" aria-label="Clear">
              <Icon name="x" :size="13" />
            </button>
          </div>
          <div v-else class="page-title">TODAY — {{ dateLabel }}<span v-if="daily.length"> · {{ daily.length }} TRACKS</span></div>
          <button class="ghost close" @click="$emit('close')" aria-label="Close">
            <Icon name="x" :size="16" />
          </button>
        </div>

        <div v-if="toast" class="toast">{{ toast }}</div>

        <div class="body">
          <template v-if="variant === 'daily'">
            <div v-if="dailyLoading" class="hint">Loading…</div>
            <div v-else-if="!daily.length" class="hint">Couldn't fetch today's picks — check NetEase login.</div>
            <div v-else class="card-grid">
              <SongCard v-for="s in daily" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
            </div>
          </template>

          <template v-else-if="!query.trim()">
            <div class="hint">Type to search.</div>
          </template>

          <template v-else>
            <div class="seg">
              <button :class="{ active: mode === 'song' }" @click="mode = 'song'">SONGS</button>
              <button :class="{ active: mode === 'artist' }" @click="mode = 'artist'">ARTISTS</button>
            </div>
            <div v-if="loading" class="hint">Searching…</div>
            <template v-else-if="mode === 'artist' && view === 'artist-songs'">
              <button class="back" @click="view = 'artists'">
                <Icon name="chevron-left" :size="13" /> {{ activeArtist?.name }} — TOP SONGS
              </button>
              <div v-if="!songs.length" class="hint">No playable tracks for this artist.</div>
              <SongRow v-for="s in songs" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
            </template>
            <template v-else-if="mode === 'artist'">
              <div v-if="!artists.length" class="hint">Nothing found for "{{ query.trim() }}".</div>
              <ArtistRow v-for="a in artists" :key="a.artist_id" :artist="a" @open="openArtist" />
            </template>
            <template v-else>
              <div v-if="!songs.length" class="hint">Nothing found for "{{ query.trim() }}".</div>
              <SongRow v-for="s in songs" :key="s.ncm_id" :song="s" :is-now="isNow(s)" @play="onPlay" @queue="onQueue" />
            </template>
          </template>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue';
import Icon from './Icon.vue';
import SongCard from './SongCard.vue';
import SongRow from './SongRow.vue';
import ArtistRow from './ArtistRow.vue';
import { playSong } from '../ws-client.js';

const props = defineProps({
  open: Boolean,
  variant: { type: String, default: 'daily' },   // 'daily' | 'search'
  now: Object,
});
const emit = defineEmits(['close']);

const query = ref('');
const mode = ref('song');          // 'song' | 'artist'
const view = ref('artists');       // artist 模式内:'artists' | 'artist-songs'
const daily = ref([]);
const dailyLoading = ref(false);
let dailyLoaded = false;
const songs = ref([]);
const artists = ref([]);
const activeArtist = ref(null);
const loading = ref(false);
const toast = ref('');
const box = ref(null);
let timer = null;
let toastTimer = null;

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dateLabel = computed(() => {
  const d = new Date();
  return `${DAYS[d.getDay()]} · ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
});

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    window.addEventListener('keydown', onKey);
    if (props.variant === 'daily' && (!dailyLoaded || !daily.value.length)) loadDaily();
    if (props.variant === 'search') nextTick(() => box.value?.focus());
  } else {
    window.removeEventListener('keydown', onKey);
  }
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  clearTimeout(timer);
  clearTimeout(toastTimer);
});

watch([query, mode], () => {
  view.value = 'artists';
  clearTimeout(timer);
  const q = query.value.trim();
  if (!q) { songs.value = []; artists.value = []; return; }
  timer = setTimeout(runSearch, 300);
});

async function loadDaily() {
  dailyLoading.value = true;
  try {
    const r = await fetch('/api/recommend').then(r => r.json());
    daily.value = r.songs || [];
    dailyLoaded = true;
  } catch { daily.value = []; }
  finally { dailyLoading.value = false; }
}

async function runSearch() {
  const q = query.value.trim();
  if (!q) return;
  loading.value = true;
  try {
    if (mode.value === 'artist') {
      const r = await fetch(`/api/search?type=artist&q=${encodeURIComponent(q)}`).then(r => r.json());
      artists.value = r.artists || [];
    } else {
      const r = await fetch(`/api/search?type=song&q=${encodeURIComponent(q)}`).then(r => r.json());
      songs.value = r.songs || [];
    }
  } catch { songs.value = []; artists.value = []; }
  finally { loading.value = false; }
}

async function openArtist(a) {
  activeArtist.value = a;
  view.value = 'artist-songs';
  loading.value = true;
  try {
    const r = await fetch(`/api/artist/songs?id=${a.artist_id}`).then(r => r.json());
    songs.value = r.songs || [];
  } catch { songs.value = []; }
  finally { loading.value = false; }
}

function isNow(s) {
  if (!props.now) return false;
  if (props.now.ncm_id != null && s.ncm_id != null) return props.now.ncm_id === s.ncm_id;
  return props.now.title === s.name;
}

function flashToast(msg) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ''; }, 2500);
}

// NCM 解析常要 2-3s:点击先给 pending 提示,免得看起来没反应
async function onPlay(s) {
  flashToast(`Playing — ${s.name}…`);
  const r = await playSong(s, 'now');
  if (!r.ok) {
    flashToast(r.reason === 'unplayable'
      ? "Can't play this one — VIP or region-locked."
      : r.reason === 'not_found'
        ? "Couldn't find a playable original."
        : "Something went wrong — try again.");
  }
}

async function onQueue(s) {
  flashToast(`Queuing — ${s.name}…`);
  const r = await playSong(s, 'queue');
  flashToast(r.ok ? `Queued — ${s.name}` : "Can't queue this one — try again.");
}
</script>

<style scoped>
.page-overlay {
  position: fixed; inset: 0;
  background: var(--ink-0);
  z-index: 300;
}
.page-col {
  max-width: 720px; margin: 0 auto; height: 100%;
  padding: 0 16px;
  display: flex; flex-direction: column;
}
.top-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 0 0; flex-shrink: 0;
}
.search-bar {
  flex: 1; display: flex; align-items: center; gap: 8px;
  padding: 8px 2px; border-bottom: 1px solid var(--rule);
  transition: border-color 0.18s;
}
.search-bar:focus-within, .search-bar.active { border-bottom-color: var(--gold); }
.search-ic { color: var(--paper-3); flex-shrink: 0; }
.search-bar:focus-within .search-ic, .search-bar.active .search-ic { color: var(--gold); }
.search-bar input {
  flex: 1; border: none; background: transparent;
  color: var(--paper-0); font-family: var(--font-serif); font-size: 14px;
  outline: none; padding: 0; min-width: 0;
}
.search-bar input::placeholder { color: var(--paper-4); }
.ghost {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--paper-3); display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex-shrink: 0;
  transition: color 0.18s;
}
.ghost:hover { color: var(--paper-0); }
.toast {
  font-family: var(--font-sans); font-size: 11px; letter-spacing: 0.5px;
  color: var(--gold); border: 1px solid var(--gold); border-radius: 2px;
  padding: 6px 10px; margin-top: 10px; flex-shrink: 0;
}
.body { flex: 1; overflow-y: auto; padding: 14px 0 24px; }
.page-title {
  flex: 1; font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px;
  color: var(--paper-3); padding: 8px 2px;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
}
.hint { font-family: var(--font-sans); font-size: 12px; color: var(--paper-4); padding: 10px 0; }
.seg { display: flex; gap: 8px; margin-bottom: 12px; }
.seg button {
  background: none; cursor: pointer;
  font-family: var(--font-sans); font-size: 10px; letter-spacing: 2px;
  color: var(--paper-3); border: 1px solid var(--ink-2); border-radius: 2px;
  padding: 4px 12px; transition: color 0.18s, border-color 0.18s;
}
.seg button.active { color: var(--gold); border-color: var(--gold); }
.back {
  background: none; border: none; padding: 6px 0; cursor: pointer;
  display: flex; align-items: center; gap: 4px;
  font-family: var(--font-sans); font-size: 10px; letter-spacing: 1.5px;
  color: var(--gold);
}
.page-enter-active, .page-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.page-enter-from, .page-leave-to { opacity: 0; transform: translateY(16px); }
</style>
