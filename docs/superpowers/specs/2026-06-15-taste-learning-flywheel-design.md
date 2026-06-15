# Taste-Learning Flywheel — Design

**Date:** 2026-06-15
**Status:** Draft for review
**Owner:** Elliot (single-user)

## Problem

The agent doesn't converge on Elliot's taste. Diagnosis (data-backed, 2026-06-15):

- **No learning store.** The cold-start design promised *"后续运行时积累的播放/反馈数据会持续修正这份档案"*, but that consolidation was never built (`consolidation: enabled:false`). `taste.md` (v0.2, 2026-05-09) and the netease library (401 songs) are **frozen** and dominate recommendations.
- **Feedback is a write-mostly log.** 90 signals collected (55 love / 23 wrong_vibe / 8 too_familiar / 4 never_again). But `love` only leaks into the *chat* prompt via probabilistic top-K recall and **decays after 90 days**; `wrong_vibe` is **not excluded anywhere**; none of it updates the core or reaches the Listen path.
- **Two disconnected paths.** Chat (`context-builder`) reads feedback weakly; Listen (`/api/listen`, the venture/wild playlists Elliot actually uses) reads only `anti_list` + recent-plays. No shared source of preference truth.
- **Loved discoveries evaporate.** 41 of 55 loves are NEW songs not in the library; loving them does nothing durable, so they re-appear as "new" and get re-loved (`breathin` ×3, `Talk that Talk` ×2).
- **Exploration aims at the wrong center.** `buildExplorePool` (NetEase `/simi/song`) runs, but is seeded from **random library songs**, never from loved / now-playing songs.
- **Skip handling is backwards.** `staleLoves` demotes loved-then-skipped songs — punishing Elliot's normal "skip a loved song to find the right-now song" behavior.

This is architectural, not a set of bugs. Prior fixes (hallucination, JSON, direction, align) tuned the **output formatter** while the **learning loop** was absent.

## Goals

1. One **durable affinity store** derived from feedback, read by **both** chat and Listen paths.
2. `love` is **cumulative and durable** — more loves → more weight; it does not time-decay (Elliot only loves *current* taste).
3. Loved songs **graduate into rotation** (stop re-appearing as "new").
4. Exploration **seeds from loved / high-affinity songs**, so "love a new artist/type → hear more of it."
5. Honor signal **semantics**: `wrong_vibe` = real negative; `too_familiar` = rest the song, keep the artist; `skip` = rotation-only (no taste penalty).
6. `taste.md`'s live half becomes a **generated view** of the store, not a frozen file.

## Non-goals

- No nightly/LLM consolidation job (YAGNI). The "live taste" the prompt needs is computed deterministically.
- No explicit genre/tag taxonomy. "Type" affinity is captured via **artist affinity + simi-neighbors of loved songs**.
- No change to `never_again` (permanent block) — it already works.
- Completion-weighted skip is deferred; skip is rotation-only for now.

## The signal model (approved)

| Signal (Elliot's meaning) | Song effect | Artist effect | Exploration | Durability |
|---|---|---|---|---|
| **love** (current like) | +cumulative weight; **graduates into rotation pool** | +cumulative weight | song becomes a **simi seed** | durable, no decay; hardens with repeats |
| **too_familiar** (听腻了) | cooldown 90d (rest) | untouched → recommend *other* songs by them | — | temporary |
| **wrong_vibe** (不喜欢) | hard-exclude | small penalty only if repeated | de-prioritize that neighborhood | durable |
| **never_again** | permanent block (`anti_list`) | — | — | permanent (unchanged) |
| **skip** | rotation-only ("don't repeat too soon"); **loved songs immune** | none | none | auto-expire |

## Architecture

A new module owns affinity; both paths consume it. Affinity is **derived on read** from existing tables (feedback is small, ~100 rows), so there is no second source of truth to keep in sync.

### New unit: `server/affinity.js`

Pure-ish functions over `state-db` reads. Cached per request.

- `songAffinity()` → `Map<songKey, {loves, ncm_id?, lastTs}>` from `love` feedback (cumulative count).
- `artistAffinity()` → `Map<normArtist, weight>` summing loves across an artist's loved songs.
- `lovedSeeds(limit)` → recent + highest-affinity loved songs **with ncm_id** (for simi seeding).
- `graduatedLibrary()` → loved songs **with ncm_id not already in the netease snapshot** → `{ncm_id, name, artist}[]` to union into the library pool.
- `negativeKeys()` → `Set<songKey>` of `wrong_vibe` songs (hard exclude) + active cooldown (too_familiar).
- `artistPenalties()` → artists with repeated `wrong_vibe` (small down-weight).
- `liveTasteBlock()` → deterministic text: top loved artists + recent loved songs (+counts) for the prompt.

`songKey` is the existing normalizer from `explore-pool.js` (reused, not duplicated).

### Data model changes (`server/state-db.js`)

- **Add `ncm_id INTEGER` to `feedback`** (migration: `ALTER TABLE ... ADD COLUMN`). The frontend already sends it ([ws-client.js:69](../../../pwa/src/ws-client.js)); the server currently drops it ([index.js:409](../../../server/index.js)). Persist it in `recordFeedback`.
- **Backfill** existing 55 loves' `ncm_id` best-effort via `cloudsearch` at first use; loves that can't resolve still count for **artist** affinity and title/artist exclusion (graduation just needs an id).
- **Remove `staleLoves`** and stop using `skipStats` for demotion (skip = rotation-only). Keep `play_events` for recency/rotation only.

### Path 1 — Listen (`/api/listen`, highest impact)

- Library pool = netease snapshot **∪ `graduatedLibrary()`**.
- Selection weighted by `songAffinity` / `artistAffinity` (loved + loved-artist songs more likely) instead of uniform random — extend `buildPlaylist` to accept optional per-song weights.
- `excludeKeys` += `negativeKeys()` (wrong_vibe + cooldown) on top of anti_list + recent plays.
- Wildcard seeds = `lovedSeeds()` (+ now-playing) instead of 5 random library songs.

### Path 2 — Chat (`server/context-builder.js`)

- Library slice & explore seeds prioritize `songAffinity` / `lovedSeeds()`.
- Inject `liveTasteBlock()` into the prompt as "Elliot 最近确认的口味" (current loves/artists); the prompt should lean on this live block over the frozen `taste.md` narrative.
- Remove the 90-day love-decay flag and `staleLoves` demotion; add `wrong_vibe` to the avoid-list + exclusion.

### `buildExplorePool` (`server/explore-pool.js`)

No internal change — callers pass `lovedSeeds()` instead of random seeds. (Already accepts arbitrary seeds.)

## Data flow

```
love/wrong_vibe/too_familiar/never_again  (frontend, with ncm_id)
        │
        ▼
  feedback table  ──derive──►  affinity.js  ──►  ┌─ Listen path: pool ∪ graduated, weighted, neg-excluded, loved-seeded
   (+ anti/cooldown)                              └─ Chat path:   slice/seeds prioritized + liveTasteBlock in prompt
        ▲
  play_events ──► rotation/recency only (no taste penalty)
```

## Testing (TDD)

- `affinity.test.js`: cumulative love weight; repeated love hardens; wrong_vibe in negativeKeys; cooldown in negativeKeys; graduatedLibrary excludes already-in-snapshot; lovedSeeds requires ncm_id; loved song NOT demoted by skips.
- `playlist-builder.test.js`: weighted selection favors high-affinity; negativeKeys excluded; empty-affinity falls back to current behavior (control).
- `state-db` migration: feedback persists ncm_id; existing rows unaffected.
- Live check on an isolated `:8099` instance (PORT + NIGHTLINER_DB on a DB snapshot, as before): love a new song → it appears in subsequent venture/wild + its artist's neighbors show up.

## Suggested phasing (for the plan)

1. **Data layer**: feedback.ncm_id capture + migration; `affinity.js` + tests. (No behavior change yet.)
2. **Listen path** (Elliot's main surface): weighted pool ∪ graduated, neg-exclude, loved seeds.
3. **Chat path**: affinity-prioritized slice/seeds + liveTasteBlock; remove decay/staleLoves; wrong_vibe negative.
4. **Backfill** existing loves' ncm_id.

Each phase ships independently and is committed + pushed per maintenance discipline; v0.5 doc updated alongside.

## Risks / open questions

- **Backfill resolution** for old loves is best-effort (NetEase search ambiguity). Acceptable: artist affinity works without ids; only graduation needs them.
- **Cold-start balance**: graduated loves should *augment*, not erase, the bootstrap library (Comfort/Cozy modes still need a familiar base). Weighting, not replacement.
- **Affinity weight curve**: linear in love-count to start (1 love = w1, 3 loves = w3); revisit only if it over-concentrates.
