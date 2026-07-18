# medium-01 · Code Blue "one tap, everything ready"

> Tier: Medium · Effort: Medium · Status: 📋 planned · Inherits [INDEX.md](INDEX.md) conventions.
> Strategy source: [`../session-1.md`](../session-1.md) Medium #4.
> ⚠ Touches the most-frozen surface in the product. Read `CLAUDE.md` §"Code Blue runtime
> guarantees" and §"Operational doctrine" BEFORE writing code.

## Goal
One tap that simultaneously: locates + soft-reserves the nearest **ready** crash cart, pages
the on-shift team, opens the timed log with drug-dose reference inline, and pushes the event to
every `/board`.

## Why 10x
Emergency is the one moment VetTrack is literally life-or-death indispensable — the product's
emotional peak and its strongest word-of-mouth/retention driver. Today the deep infra is
treated as a frozen back-end surface, not the headline. This is **packaging and surfacing**,
not rebuilding.

## Reuse (real anchors — the infra already exists)
- `server/routes/code-blue.ts` — session/log/presence/end endpoints.
- `server/lib/code-blue-linked-equipment.ts` — cart ↔ session linking already exists.
- `server/lib/code-blue-keepalive.ts`, `code-blue-reconciliation-scanner.ts` — runtime.
- `server/services/equipment-readiness-rules.service.ts` — pick the nearest *ready* cart.
- `notification.worker` — push fan-out to on-shift team.
- `src/lib/offline-emergency-block.ts` — `classifyEmergencyEndpoint()` (must keep blocking).

## Approach
1. One client action wired to a single orchestration endpoint that composes: nearest-ready-cart
   resolve → soft-reserve → session create → team page → board publish.
2. "Soft-reserve" is an **additive custody hint**, not a hard lock (never blocks a clinician
   grabbing a different cart).
3. Inline drug-dose reference in the timed log view (reference data, not a new domain).

## New schema / surfaces
- No new tables required (linking + sessions exist). Possibly a nullable `reservedForSessionId`
  hint on cart state — additive.
- One consolidated "Start Code Blue" action on mobile + board acknowledgement.

## Frozen constraints (strict — non-negotiable)
- **No new transport** (SSE only). **No offline queueing** — emergency mutations fail loud via
  the existing classifier. **Server-confirmed end** — never optimistically mark a session ended.
  **No emergency endpoint in any cache.** **Bounded-enum telemetry** only.

## Verification
- Playwright Phase-9-style drill: one tap → cart reserved + team paged + log open + board
  propagation, all observed live.
- Offline attempt blocks loudly and increments `offline_emergency_mutation_blocked_*`.
- Session end still follows the server event (no optimistic local termination).

## Effort / Risk
Medium (compose existing pieces). Risk: it touches the most-frozen surface — the *work* is
constraint-checking every step against the doctrine, not new logic.

## Open questions
- "Nearest" by room adjacency or by last-known location only?
- Drug-dose reference source — static table shipped in-app, or clinic-configurable?
