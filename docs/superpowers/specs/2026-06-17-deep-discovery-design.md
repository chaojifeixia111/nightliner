# Deep Discovery + Honor-the-Dial — Design

**Date:** 2026-06-17
**Status:** Draft for review
**Owner:** Elliot (single-user)

## Problem

A `venture` (75) request for "千禧年华语" returned 10 library songs and 1 new one, the named first song was silently dropped, and the order was library-first. Root causes (evidence from `data/llm-calls.jsonl` + `queues` 2026-06-16T16:38):

1. **Discovery is library-derived only.** Every "new" candidate comes from `simi/song` / `artist/top/song` seeded from Elliot's own library, plus the global daily pool. For a niche direction the in-direction *new* supply is ~3 songs. We never ask NetEase "give me 千禧华语 songs" directly, despite the API supporting it (verified: one playlist-search returns 6 curated playlists, 60–153 tracks each; the top one yields 30 tracks, 0 in library, all on-target).
2. **A named direction silently disables the exploration dial.** `repairFamiliarNew` skips familiar/new alignment when a direction is set ("方向 turn 不再硬对齐比例"), so `venture` becomes meaningless under any direction — undocumented, surprising.
3. **Explicitly-named songs are silently dropped.** 偏爱 was selected first but dropped on a transient NetEase resolve error (it resolves fine; ncm_id 86369), with no notice. Also `detectVerbatim("第一首我要听偏爱")` returns false — the pin regex is too strict.
4. **Chat queue keeps model order** (library-clustered); the Listen path shuffles, chat doesn't.

## Goals

1. Deep, **direction-aware** new-song discovery from NetEase (playlist-search + similar-artists + charts), for **all recommendation turns** (direction and open).
2. The exploration dial controls **both** the familiar↔new ratio **and** how adventurous the new songs are (loved-adjacent ↔ broad-genre).
3. A direction turn **honors the dial** — `venture` + 千禧华语 → mostly *new* Chinese, never off-direction padding.
4. **Never silently drop an explicitly-named song**; retry once, else tell the user.
5. **Shuffle** the chat queue (keep a pinned song first).
6. Agency preserved: NetEase candidates are reranked to Elliot's taste, never served in platform order.

## Non-goals

- **No web search.** The LLM's parametric music knowledge + NetEase discovery cover the genres Elliot listens to; web search is a possible separate Phase 2, not now.
- No change to NetEase catalog limits (de-listed Western / copyright-trap artists stay unavailable).
- No new persistent storage — discovery is fetched + cached in memory.

## Architecture

### New unit: `server/discovery.js`

`buildDiscoveryPool({ direction, mode, lovedArtists, libKeys, excludeKeys, limit })` → `Promise<Candidate[]>` where `Candidate = { name, artist, ncm_id, via:string[], kind }`. Owns: source-blending, dial-tiers, affinity rerank. Depends on `ncm-client`, `explore-pool` (near tier), `affinity` (rerank), `direction` (focus keyword).

**Two tiers, blended by the dial (`mode.value` 0–100):**

- **Near tier** (low dial — close to your taste): reuse the existing `buildExplorePool` (simi/song of loved songs + same-artist deep-cut). Already works; not duplicated.
- **Far tier** (high dial — bold, NEW): the new sources —
  - **Direction turn:** `searchPlaylists(directionKeyword)` → take top N curated playlists by playCount → `playlistTrackAll` → tracks. Plus genre `toplist`s relevant to the direction.
  - **Open turn:** `simiArtist(id)` of your top loved artists (resolve names→ids via `searchArtists`, capped at ~3) → their `artistTopSongs`; plus new/hot `toplist`s. (No keyword playlist-search without a named genre.)

**Blend:** `farFraction = mode.value / 100` (Comfort 0% far → Wild 65%+ far, matching the existing wildcard ratios). The pool is `near*(1-farFraction) + far*farFraction`, sized to `limit` (~24).

**Focus:**
- Direction → keyword from `directionQuery(direction)` (e.g. "千禧 华语", "国语 女声"); artist seeds = in-direction loved/library artists.
- Open → artist seeds = top loved artists (`affinity.artistAffinity`); far tier = charts + similar-artists.

### Agency / personalization (no parroting)

Raw far-tier candidates (genre playlists = generic popularity) are:
1. dedup'd by `songKey`, excluded against `libKeys` + `excludeKeys` (anti/cooldown/recent/wrong_vibe),
2. **reranked by affinity** (`songWeight`: boost artists Elliot loves / similar-to-loved) + random noise,
3. handed to the LLM as candidates, which does final curation.

So "千禧华语" narrows toward *Elliot's* lane (loved 华语女声 artists rank up), not NetEase's top-played order.

### Wiring: `server/context-builder.js`

`buildDiscoveryPool` runs **parallel to RAG** (like `getRecommendPool`). Its output merges into the `explorePool` (wildcard candidates) shown to the model and passed to `align-batch` meta. The existing direction filtering still applies.

### Honor-the-dial: `server/align-batch.js`

- The familiar/new ratio step (step 2) currently runs only when `!direction && !verbatim`. Change to run when **`!verbatim`** — so direction turns align too, swapping only with **in-direction** candidates (already filtered by `matchesDir`). With the discovery pool now deep, `venture`+千禧华语 pulls in-direction *new* up to the ratio.

### Pinned-first vs verbatim (`server/direction.js`)

Split the conflated concept:
- **`detectVerbatim`** ("直接/原样/按顺序放每日推荐") → `meta.verbatim` → skip alignment **entirely** (play as-is). Existing.
- **`detectPinnedFirst`** ("第一首放/要/是/听 X", tolerant of intervening chars like 歌/我要) → `meta.pinnedFirst` → `align-batch` **keeps `play[0]`** and applies the ratio to `play[1:]`. So "第一首放偏爱" + venture = 偏爱 first, *then* mostly-new in-direction.

### Pinned-drop safety: `server/index.js` + `server/playback-coordinator.js`

When `pinnedFirst` and the model's `play[0]` fails to resolve: **retry the resolve once**; if it still fails, broadcast a system notice ("「偏爱」这次没找到能播的版本") instead of silently dropping it.

### Chat queue order: `server/queue-ops.js`

Add an arrange step in `applyChatRecommendation` (or a small helper): **shuffle `playable`**, but if `pinnedFirst` and the pinned song survived, keep it at index 0 and shuffle the rest. (Listen path already shuffles; this makes chat consistent.)

### New `ncm-client.js` wrappers

- `searchPlaylists(keywords, {limit})` → `cloudsearch type=1000` → `result.playlists`.
- `simiArtist(id)` → `/simi/artist` → `artists`.
- `toplist()` → `/toplist` → `list` (each is a playlist id → `playlistTrackAll`).

## Data flow

```
turn → focus (direction keyword | loved-taste-center) + mode
  └─ buildDiscoveryPool (parallel to RAG):
        near = buildExplorePool(lovedSeeds)            ── close to you
        far  = searchPlaylists(focus)+toplist tracks   ── bold/new   (direction)
             | simiArtist(loved)+charts                 ──            (open)
        blend by mode.value → dedup/exclude → affinity rerank → limit
  └─ context-builder merges into explorePool → prompt + align meta
  └─ align-batch: direction step1 (hard filter) → step2 ratio (now runs for
        direction; protects play[0] when pinnedFirst; skipped when verbatim)
  └─ resolve (retry pinned once; notice if pinned drops)
  └─ shuffle queue (keep pinned first) → broadcast
```

## Testing (TDD)

- `ncm-client`: thin wrappers — covered indirectly; no unit test (network).
- `discovery.test.js`: blend math (mode.value → far fraction; near-only at Comfort, far-heavy at Wild); dedup + library/exclude filtering; affinity rerank ordering; graceful empty (NetEase down → returns near tier / empty, never throws). NetEase calls **injected/faked** (unavoidable network boundary).
- `direction.test.js`: `detectPinnedFirst` catches "第一首我要听 X / 第一首歌要 X / 第一首放 X"; does not fire on plain requests; `detectVerbatim` unchanged for 直接/原样.
- `align-batch.test.js`: ratio now runs for a direction turn (swaps to in-direction new); `pinnedFirst` keeps index 0 while aligning the rest; `verbatim` still skips entirely.
- `queue-ops.test.js`: arrange shuffles; keeps pinned first when present; empty-playable guard intact.
- Live check on isolated `:8099` (DB snapshot): "千禧华语 venture" yields mostly new in-direction songs; "第一首我要听 X" keeps X first; a pinned unplayable song produces a notice.

## Phasing (for the plan)

1. **`ncm-client` wrappers** + `discovery.js` core (blend/dedup/rerank) + tests, NetEase faked.
2. **Wire into `context-builder`** (parallel fetch, merge into explorePool) + cache per focus (~30 min).
3. **Honor-the-dial** in `align-batch` (run ratio for direction; in-direction candidates).
4. **Pinned-first split** (`detectPinnedFirst` + regex) + `align-batch` protect index 0.
5. **Pinned-drop retry/notice** + **chat queue shuffle**.

Each phase ships independently, committed + pushed (feature branch), v0.5 doc synced alongside.

## Risks / open questions

- **Latency:** discovery adds several NetEase calls. Mitigate with per-focus 30-min cache + `Promise.allSettled` + run parallel to RAG; far tier is best-effort (failure → fall back to near tier).
- **Generic-popularity bias:** affinity rerank + LLM curation keep it in Elliot's lane, but a brand-new genre with no affinity signal will lean popular until he gives feedback — acceptable.
- **Artist-id resolution** for `simiArtist` on open turns costs an extra `searchArtists` per seed — cap at ~3 seeds, cache.
- **`toplist` relevance:** mapping a direction/taste to the right genre chart is fuzzy; start with playlist-search as the primary far source, charts as a secondary booster.
