# R-CBF-1 — Code Blue "one tap, everything ready" (SUB-SPEC + plan)

- **Covers:** medium-01 (spec §6.2). **Frozen Code Blue surface — read `CLAUDE.md` §"Code Blue runtime guarantees" + §"Operational doctrine" before any card.**
- **Nature:** packaging + surfacing of already-deep infra — **not** a runtime rebuild.
- **Gated behind stabilize:** `T-32` (R-CB-02 null-keepalive grace) + `T-33` (R-CB-03 log rollback) must be GREEN first (`phase-2-3.plan.md`). Do not build the feature on the open races.
- **Card contract:** RED→GREEN→verify; frozen guardrails per card; realtime/Code-Blue cards also require the Playwright drill.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate + the Code Blue Playwright drill on **every** card (most-frozen surface in the product). See README → "Execution driver".
- **Review resolutions (decisions pinned):**
  1. **Orchestration (R-CBF-1.1) is one transactional/compensating unit**, `clinicId`-scoped on every step, with an **idempotency key = `(clinicId, initiatingUserId, coarse-time-bucket)`** so a double-tap produces exactly one session; partial failure **compensates** (release the reservation, leave no orphan session/page).
  2. **Soft-reserve (R-CBF-1.2) uses compare-and-set:** set `reservedForSessionId` only where it is currently null; on collision the loser re-resolves to the next-nearest ready cart — it never overwrites an existing reservation.

## Frozen doctrine (every card obeys — non-negotiable)

No new transport (SSE only) · **no offline queueing** (emergency mutations fail loud via `classifyEmergencyEndpoint`) · **server-confirmed end** (never optimistic local termination) · **no emergency endpoint in any cache** · **bounded-enum telemetry only**.

## Design (from the mobile/HIG lens): arm → hold-to-confirm

"One tap" literally = an accidental-Code-Blue generator (phone in a scrub pocket) and fights Apple's deliberate-confirmation rule. Resolution (Apple Emergency-SOS precedent): **tap = arm** (navigate to a full-screen armed screen, unswipeable) → **commit = a ~700–900ms press-and-hold** with an escalating haptic ramp + a filling ring, always-visible **Cancel**. Reads as one gesture, instant under stress, pocket-proof.

## Reuse anchors (verify at build)

`server/routes/code-blue.ts` (session/log/presence/end) · `server/lib/code-blue-linked-equipment.ts` (cart↔session link) · `server/lib/code-blue-keepalive.ts` · `server/services/equipment-readiness-rules.service.ts` (nearest *ready* cart) · `notification.worker` (team page) · `src/lib/offline-emergency-block.ts` (`classifyEmergencyEndpoint` — must keep blocking) · `src/pages/code-blue.tsx` (checklist-gated start) · `src/native/NativeTabBar.tsx` emergency slot + `HomeChrome` banner · `src/lib/haptics.ts`.

---

### R-CBF-1.1 · Orchestration endpoint (compose, don't rebuild)

- **Goal:** one server action that composes: resolve **nearest ready** crash cart (`equipment-readiness-rules.service.ts`) → **soft-reserve** it → create the session (`code-blue.ts`) → page the on-shift team (`notification.worker`) → publish to every `/board` (existing outbox/SSE).
- **RED:** `tests/code-blue-one-tap-orchestration.test.ts` — one call yields: a reserved nearest-ready cart, a created session linked to it, a queued team page, and a board-publish event. Cross-clinic isolation asserted.
- **Guardrail:** all steps online-only; the endpoint is an emergency mutation (classifier blocks it offline); no optimistic client state.
- **Verify:** `pnpm test -- tests/code-blue-one-tap-orchestration.test.ts && pnpm typecheck`.

### R-CBF-1.2 · Soft-reserve = additive custody hint (never a hard lock)

- **Goal:** a nullable `reservedForSessionId` hint on cart state — **never blocks** a clinician grabbing a different cart.
- **RED:** `tests/code-blue-soft-reserve.test.ts` — reserving a cart sets the hint; a checkout of a *different* cart is unaffected; ending the session clears the hint.
- **Guardrail:** additive column; no change to custody-toggle semantics; RFID/custody non-goals preserved.

### R-CBF-1.3 · Client arm→hold-to-confirm (the safe "one tap")

- **Goal:** tab-bar emergency slot / `HomeChrome` banner → **full-screen armed screen** (reuse checklist-gated `code-blue.tsx`) → **hold-to-start** control (~700–900ms, `haptics.warning()`→`haptics.locked()` ramp, filling ring) → fires R-CBF-1.1 on commit; always-visible Cancel (never traps — ties to the R-CB-01 fix). Phone *initiates*; iPad/board *run*.
- **RED:** `tests/code-blue-hold-to-confirm.test.tsx` — a single tap does NOT create a session; a completed hold does; Cancel dismisses without starting; ≥56px targets; reduced-motion fallback for the ring.
- **Guardrail:** a11y — the live-log `aria-live` throttled; keyboard/switch operable; focus-managed.

### R-CBF-1.4 · Inline drug-dose reference in the timed log

- **Goal:** reference data (not a new domain) shown inline in the timed-log view.
- **RED:** `tests/code-blue-drug-reference.test.tsx` — the reference renders in the log; he+en; no PII; no network dependency if static.
- **Open decision:** static in-app table vs clinic-configurable (see below).

### R-CBF-1.5 · e2e drill + doctrine verification (acceptance bar)

- **Playwright drill** (Phase-9 style): one arm→hold → cart reserved + team paged + log open + **board propagation**, observed live.
- **Offline block:** an offline attempt blocks loudly and increments `offline_emergency_mutation_blocked_*`.
- **Server-confirmed end:** session end still follows the SSE event (no optimistic local termination).
- **Verify:** the Code Blue Playwright drills + `pnpm typecheck`.

## Open decisions (confirm at build)

- **"Nearest" cart:** by room adjacency, or last-known location only? (adjacency depends on R-M1.2's adjacency model if that ships first).
- **Drug-dose source:** static shipped table vs clinic-configurable.
