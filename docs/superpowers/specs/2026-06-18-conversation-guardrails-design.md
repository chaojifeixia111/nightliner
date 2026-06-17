# Conversation Guardrails — Design

**Date:** 2026-06-18
**Status:** Approved for implementation
**Owner:** Elliot (single-user)

## Problem

The 2026-06-18 conversation probe found several failures where the DJ said or queued something that the deterministic server layer should have prevented:

1. **Partial direction overwrite.** `下一批，我只要女声的` after KPOP replaced the whole direction with only `女声`, losing `韩语/KPOP`.
2. **No gender hard guard.** `KPOP 女声` still allowed `align-batch` to insert known male groups such as CNBLUE because `songMatchesDirection` only enforces language and artist.
3. **Verbatim order lost late.** `meta.verbatim` skips familiar/new slot replacement, but the final `arrangeQueue` call still shuffles the playable queue.
4. **Acknowledgment fallback happens too late.** Pure confirmation words such as `嗯` are forced to `chat` only after the LLM has already streamed a recommend opener and produced `queueAction`.
5. **Malformed play entries are accepted.** Missing required fields such as `reason` can reach playback resolution and produce queue items with `reason:null`.
6. **Openers over-promise.** The LLM may name a song or exact count before server-side resolution, repair, filtering, and shuffling finish.

## Decision

### Direction state

Direction state is a server-owned hard constraint. For continuation/correction turns, detected partial directions are merged with the existing direction as `base ∩ new`:

- `KPOP` then `下一批，我只要女声的` => `韩语 · 女声`
- `国语女声` then `我说了中文` => `中文/国语 · 女声`
- `KPOP 女声` then `我要听KPOP啊` => keep `韩语 · 女声`

Unmentioned dimensions are preserved on continuation/correction. They are cleared only by explicit reset/open language (`随便`, `都行`, `不限`, etc.) or by an explicit replacement of that dimension (`换成英文男声`, `不限男女`, `男女都行`).

### Gender matching

Add a conservative artist gender table to `server/direction.js`.

- Known female soloists / female groups satisfy `female` and reject `male`.
- Known male soloists / male groups satisfy `male` and reject `female`.
- Mixed/collab/unknown artists are allowed, so the guard removes obvious bad insertions without over-filtering the catalog.

This table is a deterministic backstop for curated known artists only; the LLM still handles nuanced or unknown cases.

### Verbatim ordering

`verbatim` must reach the final queue arrangement layer. When true, the queue keeps the resolved playable order. Unplayable tracks may still be dropped, but surviving tracks are not shuffled.

### Acknowledgment short-circuit

Pure acknowledgment messages are handled before prompt construction and before any LLM call:

- broadcast a short chat response,
- do not change queue,
- record `intent=chat`,
- record no `play_titles_json` and no `queue_action`.

### Play item validation

Before repair and playback resolution, normalize `parsed.play`:

- require `title`, `artist`, `reason`, and valid `source_pool`,
- drop malformed entries,
- if all entries are dropped, keep the queue unchanged and notify the user.

The server should not fabricate per-song reasons after the model omitted them; missing reasons are treated as malformed recommendation output.

### Opener safety

Prompt rules should say recommend openers must not mention concrete song names, artist names, exact queue counts, or promises like `不替换不重排`. Those details are only reliable after server resolution and repair.

## Implementation Surface

- `server/direction.js`
  - Add direction merge helper.
  - Add gender keyword reset/replacement detection.
  - Add conservative artist gender matching into `songMatchesDirection`.
- `server/index.js`
  - Use the new direction resolver.
  - Pre-short-circuit pure acknowledgments.
  - Validate play entries before `repairFamiliarNew`.
  - Pass `verbatim` to queue arrangement.
- `server/queue-ops.js`
  - Add `verbatim` option to `arrangeQueue`.
- `server/align-batch.js`
  - Benefits from stronger `songMatchesDirection` without owning gender logic.
- `prompts/system.md`
  - Tighten opener wording.
- `nightliner-design-v0.5.md`
  - Document direction merge, gender guard, verbatim final-order preservation, ack short-circuit, and play validation.

## Tests

Add focused unit tests before implementation:

1. Direction merge preserves unmentioned dimensions in continuation/correction.
2. Explicit reset and gender reset clear dimensions.
3. Known male K-pop groups reject `female`; known female groups reject `male`; unknown stays allowed.
4. `repairFamiliarNew` cannot insert known male groups under `KPOP 女声`.
5. `arrangeQueue(..., { verbatim:true })` preserves order while non-verbatim still shuffles.
6. Play validation drops missing-reason items.

## Non-goals

- No broad genre taxonomy or full artist metadata service.
- No live LLM conversation replay in the unit test layer.
- No changes to NetEase resolution semantics beyond refusing malformed model output before resolution.
