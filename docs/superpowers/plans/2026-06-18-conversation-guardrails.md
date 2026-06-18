# Conversation Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for implementation changes and superpowers:verification-before-completion before claiming completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 2026-06-18 conversation report regressions by moving direction merge, gender filtering, verbatim ordering, acknowledgment handling, and play schema validation into deterministic server logic.

**Design:** `docs/superpowers/specs/2026-06-18-conversation-guardrails-design.md`

**Tech stack:** Node ESM, node:test, existing modules (`direction`, `align-batch`, `queue-ops`, `index`, prompt markdown, `nightliner-design-v0.5.md`).

---

## Task 1: Direction merge + gender matching

**Files:**
- Modify: `server/direction.js`
- Modify: `tests/direction.test.js`

- [x] Add failing tests for continuation/correction merging:
  - KPOP + `下一批，我只要女声的` => Korean female.
  - Chinese female + `我说了中文` => Chinese female.
  - Korean female + `我要听KPOP啊` => Korean female.
  - Explicit reset / `不限男女` clears the relevant constraint.
- [x] Add failing tests for gender hard matching:
  - CNBLUE/BIGBANG reject female KPOP direction.
  - TWICE/IVE accept female and reject male.
  - Unknown artist remains allowed for gender-only certainty.
- [x] Implement a small direction state helper that merges partial directions only on continuation/correction.
- [x] Add conservative `ARTIST_GENDER` metadata and enforce it inside `songMatchesDirection`.

## Task 2: Align-batch cannot insert known gender mismatches

**Files:**
- Modify: `tests/align-batch.test.js`
- Maybe no production file beyond `direction.js`.

- [x] Add failing test where KPOP female direction has a male-group explore candidate and a female candidate.
- [x] Confirm repair chooses the female candidate or drops the off-direction slot.

## Task 3: Verbatim final ordering

**Files:**
- Modify: `server/queue-ops.js`
- Modify: `tests/queue-ops.test.js`
- Modify: `server/index.js`

- [x] Add failing `arrangeQueue(..., { verbatim:true })` order-preservation test.
- [x] Implement `verbatim` option in `arrangeQueue`.
- [x] Pass `verbatim` from `/api/chat` to final arrangement.

## Task 4: Acknowledgment and play validation helpers

**Files:**
- Modify: `server/index.js`
- Create/modify tests as appropriate.

- [x] Extract pure helpers from `index.js` if needed to make validation testable without starting the server.
- [x] Add test for play item validation dropping missing `reason` and normalizing missing/invalid `source_pool`.
- [x] Pre-short-circuit `isAcknowledgment(message)` before prompt construction and LLM call.
- [x] Ensure recorded chat turn for acknowledgment has `intent=chat`, empty play list, and no queue action.

## Task 5: Prompt and design doc sync

**Files:**
- Modify: `prompts/system.md`
- Modify: `nightliner-design-v0.5.md`

- [x] Tighten opener rule: no song names, artist names, exact counts, or final-order promises in recommend opener.
- [x] Document server-side base-intersection direction merge.
- [x] Document conservative gender guard and unknown-artist behavior.
- [x] Document verbatim final ordering and play validation.

## Task 6: Verification and git maintenance

- [x] Run targeted tests:
  - `node --env-file=.env --test tests/direction.test.js`
  - `node --env-file=.env --test tests/align-batch.test.js`
  - `node --env-file=.env --test tests/queue-ops.test.js`
  - any new helper test file.
- [x] Run full suite: `npm test`.
- [x] Review `git diff`.
- [x] Commit with Conventional Commit.

## 2026-06-18 Follow-up: source_pool tolerance

- [x] Root cause: a valid recommend payload with `title/artist/reason` but no `source_pool` was normalized to an empty play list, so `replace_all` produced no queue.
- [x] Regression test: missing/invalid `source_pool` keeps the item and normalizes it to `wildcard`; missing `title/artist/reason` is still dropped.
- [x] Design and prompt docs now distinguish required playback fields from the advisory `source_pool` label.

## 2026-06-18 Follow-up: fresh direction resets

- [x] Root cause: `来一批华语流行` matched the continuation regex and merged with stale `男声 · 艺人:陶喆、李荣浩、林俊杰`, causing a broad request to stay narrowly artist-locked.
- [x] Regression tests: fresh language requests clear stale gender/artists; pure `下一批` still carries; explicit artist requests clear incompatible previous language/gender.
- [x] Design and prompt docs now distinguish pure continuation/refinement from fresh explicit language/artist requests.
