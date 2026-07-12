# R-CBF-1 — Code Blue "one tap, everything ready" (SUB-SPEC + plan)

- **Covers:** medium-01 (spec §6.2). **Frozen Code Blue surface — read `CLAUDE.md` §"Code Blue runtime guarantees" + §"Operational doctrine" before any card.**
- **Nature:** packaging + surfacing of already-deep infra — **not** a runtime rebuild.
- **Gated behind stabilize:** `T-32` (R-CB-02 null-keepalive grace) + `T-33` (R-CB-03 log rollback) must be GREEN first (`phase-2-3.plan.md`). Do not build the feature on the open races.
- **Card contract:** RED→GREEN→verify; frozen guardrails per card; realtime/Code-Blue cards also require the Playwright drill.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate + the Code Blue Playwright drill on **every** card (most-frozen surface in the product). See README → "Execution driver".
- **All decisions are pinned in the cards below** (cart-selection rule, request-scoped idempotency token, atomic transaction boundary, soft-reserve compare-and-set, executable a11y/hold-boundary) — no open choices.

## Frozen doctrine (every card obeys — non-negotiable)

No new transport (SSE only) · **no offline queueing** (emergency mutations fail loud via `classifyEmergencyEndpoint`) · **server-confirmed end** (never optimistic local termination) · **no emergency endpoint in any cache** · **bounded-enum telemetry only**.

## Design (from the mobile/HIG lens): arm → hold-to-confirm

"One tap" literally = an accidental-Code-Blue generator (phone in a scrub pocket) and fights Apple's deliberate-confirmation rule. Resolution (Apple Emergency-SOS precedent): **tap = arm** (navigate to a full-screen armed screen, unswipeable) → **commit = an exactly-800ms press-and-hold** with an escalating haptic ramp + a filling ring, always-visible **Cancel**. Reads as one gesture, instant under stress, pocket-proof.

## Reuse anchors (verify at build)

`server/routes/code-blue.ts` (session/log/presence/end) · `server/lib/code-blue-linked-equipment.ts` (cart↔session link) · `server/lib/code-blue-keepalive.ts` · `server/services/equipment-readiness-rules.service.ts` (nearest *ready* cart) · `notification.worker` (team page) · `src/lib/offline-emergency-block.ts` (`classifyEmergencyEndpoint` — must keep blocking) · `src/pages/code-blue.tsx` (checklist-gated start) · `src/native/NativeTabBar.tsx` emergency slot + `HomeChrome` banner · `src/lib/haptics.ts`.

---

### R-CBF-1.1 · Orchestration endpoint (compose, don't rebuild)

- **Goal:** one server action that composes, in order: **(1) claim/look up the idempotency record for `(clinicId, token)` — the FIRST transactional step, before any cart lookup or reservation; on an existing token, replay the stored session + the **current durable paging state** with NO cart/session side effects** → (2) resolve the **nearest ready** cart → (3) **CAS soft-reserve** it → (4) create the session (`code-blue.ts`) → (5) insert the realtime outbox event → enqueue the team page. **`clinicId`-scoped on every step.**
- **Cart-selection rule (pinned):** "nearest ready" = the ready cart with the smallest **room-adjacency distance** to the **initiating location**, whose source is pinned (no implicit GPS / last-scanned drift): **the initiating user's current room from their open `vt_clinical_check_ins` row → else their last equipment-scan room (last-known) → else, if neither is known, NO distance is used and selection falls back to any ready cart**. The armed screen (R-CBF-1.3) **captures this location value and passes it to the endpoint**, so the RED test asserts a deterministic cart from an explicit location, never an ambient source. Adjacency distance uses R-M1.2's model when present, else last-known-location distance; deterministic tie-break by ascending cart id.
- **Idempotency (pinned — request-scoped token, NOT a time bucket):** the client generates **one token per hold gesture** (R-CBF-1.3), persisted across retries; the endpoint enforces uniqueness per **`(clinicId, token)`** and **replays the original result** on a duplicate. (A time bucket could merge two legitimate incidents by the same user, or duplicate across a bucket boundary.)
- **Transaction boundary (pinned):** the **idempotency claim is the first step**; then cart lookup + **CAS reservation + session creation + outbox insert commit atomically** (one DB transaction). **The idempotency record is bound to the COMMITTED session — a duplicate replays ONLY when a committed session exists for `(clinicId, token)`.** **Fencing (pinned — a short TTL alone is unsafe against a slow-but-still-active owner):** the claim carries a **monotonic fencing/version token** and the create path is guarded so **only the current fence-holder can commit** — an owner whose fence was superseded (its lease taken over) **is rejected on commit**, so a retry can never create a second session that then races the original's commit. A **unique-conflict on `(clinicId, token)` whose owning transaction COMMITTED aborts before any cart side effect** and the endpoint replays the stored session + the **current durable paging state**. **If the prior attempt ABORTED / never committed / had its fence superseded (claim present but no committed session), a retry takes a fresh fence, RE-CLAIMS, and proceeds with a new reservation/session transaction; it must NOT replay an empty result nor permanently reject the token.** **Paging status is durable AND distinct from the replay result (pinned):** the transaction can only record that paging was **enqueued** — it persists a paging state of `queued | processing | sent | failed`, and a replay returns the **current** state (never a static "success", so a pending job is not reported delivered and a DLQ'd job is not replayed as sent). **Paging rides the EXISTING outbox:** it is written to `vt_event_outbox` within the same commit and delivered by the existing **`startEventOutboxPublisher` (the sole outbox reader)** through its typed event/consumer path with the existing retry + DLQ semantics — **no second outbox polling/drain loop is introduced.** **Never delete a committed session** after its outbox event published — end is server-confirmed only.
- **Compensation:** if the transaction aborts nothing persists (the CAS reservation rolls back with it); if the post-commit page job exhausts retries it lands in the DLQ without affecting the session.
- **RED:** `tests/code-blue-one-tap-orchestration.test.ts` — one call yields a reserved nearest-ready cart + a session linked to it + an outbox event + an enqueued page; a **duplicate token replays the same session with NO second cart reservation attempted**; **two concurrent starts with the same token resolve through the single duplicate-replay path**; **an aborted transaction leaves no partial session/reservation**; **an aborted/uncommitted owner followed by a retry with the same token RE-CLAIMS and creates a fresh committed session + reservation (no empty replay, no permanent token rejection)**; cross-clinic isolation asserted.
- **Guardrail:** all steps online-only; **the endpoint is registered with `classifyEmergencyEndpoint` (`src/lib/offline-emergency-block.ts`) and all client calls go through a typed `src/lib/api.ts` wrapper **with a matching request/response type in `src/types/` (or `shared/`), enforced by `pnpm typecheck`** — no raw fetch may bypass the guard**; no optimistic client state. A focused offline test (see R-CBF-1.5) proves the mutation fails loudly + increments `offline_emergency_mutation_blocked_*` and is never queued.
- **Verify:** `pnpm test -- tests/code-blue-one-tap-orchestration.test.ts` + **`npx tsc --noEmit`** + **`pnpm typecheck`** (also covers the server tsconfig) + `pnpm test` + the Code Blue Playwright drill.

### R-CBF-1.2 · Soft-reserve = additive custody hint (compare-and-set)

- **Goal:** a nullable `reservedForSessionId` hint on cart state — **never blocks** a clinician grabbing a different cart. Set via **compare-and-set: write only where `reservedForSessionId IS NULL`.**
- **Collision rule (pinned):** on a CAS miss (another session reserved it first) the loser **re-resolves to the next eligible ready cart** and never overwrites; if none remain it returns an explicit no-cart-available signal (the session still starts — the reservation is advisory).
- **Cleanup:** a failed **or** ended session clears **only its own** `reservedForSessionId` (scoped by session id), never another session's.
- **RED:** `tests/code-blue-soft-reserve.test.ts` — reserving sets the hint; a checkout of a *different* cart is unaffected; **two concurrent starts: the loser cannot overwrite the winner's `reservedForSessionId`, receives the next cart (or an explicit conflict), and neither clears the other's reservation**; a failed session and an ended session each clear only their own hint.
- **Guardrail:** additive column; no change to custody-toggle semantics; RFID/custody non-goals preserved.

### R-CBF-1.3 · Client arm→hold-to-confirm (the safe "one tap")

- **Goal:** tab-bar emergency slot / `HomeChrome` banner → **full-screen armed screen** (reuse checklist-gated `code-blue.tsx`) → **hold-to-start** control (**exactly 800ms**, `haptics.warning()`→`haptics.locked()` ramp, filling ring) that **generates the per-gesture idempotency token AND captures the initiating location** (check-in room → last-scan room → none, per R-CBF-1.1's cart-selection rule) to pass to the endpoint (R-CBF-1.1) → fires R-CBF-1.1 on commit; always-visible Cancel (never traps — ties to the R-CB-01 fix). Phone *initiates*; **iPad and board are display-only — they render server-confirmed sessions and CANNOT arm, hold, or start a session locally**.
- **RED (a11y + hold-boundary are executable, not prose):** `tests/code-blue-hold-to-confirm.test.tsx` — assert: a single tap does NOT create a session; a **completed** hold does (one token); **early release before 800ms does NOT fire (fake-timer boundary: 799ms → no fire, 800ms → fire)**; Cancel dismisses without starting; the control is operable by **keyboard/switch activation** (not pointer-only); **focus enters the armed screen on open and returns to the trigger on cancel/close**; live-log `aria-live` announcements are **throttled/batched** (not one-per-entry); ≥56px targets; reduced-motion fallback for the ring.
- **Guardrail:** every a11y assertion above is test-enforced (emergency flow — no gesture-only or hover-only affordance).

### R-CBF-1.4 · Inline drug-dose reference in the timed log

- **Goal:** a **static, versioned, clinician-approved** drug-dose reference shown inline in the timed-log view (reference data, not a new domain). **Clinical provenance is MANDATORY — rendering alone is insufficient (this is clinical-critical):** each entry carries a **named clinician-approved source**, a **version + effective date**, explicit **species / weight-band / concentration / unit** scope, and a **named review/update owner**; the bundled table is versioned and its provenance is shown with the reference.
- **RED:** `tests/code-blue-drug-reference.test.tsx` — the reference renders with its **source + version/effective-date + species/weight/concentration/unit scope + review owner**; an entry **missing any provenance field FAILS validation** (unsourced or scope-less dose guidance cannot ship); he+en; no PII; no network dependency.
- **Guardrail (clinical safety):** stale or unsourced dose guidance is a safety defect — provenance fields are enforced, not optional; clinic-configurability deferred beyond v1.

### R-CBF-1.5 · e2e drill + doctrine verification (acceptance bar)

- **Playwright drill** (Phase-9 style): one arm→hold → cart reserved + team paged + log open + **board propagation**, observed live.
- **Offline block:** an offline attempt blocks loudly and increments `offline_emergency_mutation_blocked_*`.
- **Server-confirmed end:** session end still follows the SSE event (no optimistic local termination).
- **Verify:** the Code Blue Playwright drills + **`npx tsc --noEmit`** + **`pnpm typecheck`** (also covers the server tsconfig) + `pnpm test`.

## Resolved (were open decisions — now pinned)

- **"Nearest" cart:** room-adjacency distance (R-M1.2 model when present, else last-known distance), tie-break by cart id — pinned in R-CBF-1.1.
- **Drug-dose source:** a **static, versioned in-app reference table** shipped in the bundle (no network dependency, no clinic-config in v1); clinic-configurability is a later addition, not v1. R-CBF-1.4's RED asserts the static table renders with no network dependency.
