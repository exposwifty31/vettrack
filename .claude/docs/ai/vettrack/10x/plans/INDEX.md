# VetTrack 10x — Plan Library

Standalone, executable feature plans derived from the 10x strategy analysis
([`../session-1.md`](../session-1.md)). Each file is a **~1-page executable brief**: enough
for a fresh session to implement without re-deriving strategy or re-exploring the codebase.

**To execute one:** prompt `execute .claude/docs/ai/vettrack/10x/plans/<file>`.

Every plan inherits the [Shared conventions](#shared-conventions-all-plans-inherit) below —
each brief only calls out what is *specific or frozen* for that feature.

## Plans

| ID | Title | Tier | Effort | Status | One-line |
|----|-------|------|--------|--------|----------|
| [small-01](small-01-locate.md) | "Where is it?" locate | Small | Low | 📋 planned | Search → device location + custodian + readiness, instantly |
| [small-02](small-02-readiness-badge.md) | Grab & go readiness badge | Small | Low | 📋 planned | One 🟢/🟡/🔴 indicator per device, everywhere |
| [medium-02](medium-02-shift-handover.md) | Shift handover artifact | Medium | Medium | 📋 planned | Auto "what changed / what's open," acked to next shift |
| [small-03](small-03-expiry-lowstock-nudge.md) | Expiry / low-stock nudge | Small | Low | 📋 planned | Route existing worker signals to the right person, early |
| [small-04](small-04-damaged-at-checkin.md) | One-tap "returned damaged" | Small | Low | 📋 planned | Capture damage at check-in → seeds the loss story |
| [massive-02](massive-02-predictive-readiness.md) | Predictive readiness engine | Massive | High | 📋 planned | "Will you be ready" — demand vs. ready supply vs. burn |
| [medium-01](medium-01-code-blue-one-tap.md) | Code Blue "one tap" | Medium | Medium | 📋 planned | One tap: cart + page + timed log + board |
| [medium-03](medium-03-ambient-board-alerts.md) | Ambient board alerts | Medium | Medium | 📋 planned | `/board` surfaces anomalies before you ask |
| [small-05](small-05-start-of-shift-card.md) | Start-of-shift card | Small | Low–Med | 📋 planned | Per-role "first thing you see" summary |
| [massive-01](massive-01-passive-tracking.md) | Passive location (BLE/RFID) | Massive | Very High | 🚧 gated | Kill the scan — ambient custody truth |
| [massive-03](massive-03-clinic-network.md) | Clinic network + benchmarks | Massive | High | 🚧 gated | Cross-site sharing + peer benchmarking |
| [medium-04](medium-04-asset-copilot.md) | Asset Copilot + voice | Medium | Med–High | 🚧 gated | NL ops Q&A; hands-free in chaos |

**Status key:** 📋 planned = ready to execute now · 🚧 gated = needs an owner decision first
(see each brief's "Standing blocker").

## Recommended execute-order

`small-01` → `small-02` → `medium-02` → `small-03` + `small-04` → `massive-02` →
`medium-01` → `medium-03`. Then, once their blockers clear: `massive-01`, `massive-03`,
`medium-04`. `small-05` is cheap and fits anywhere.

Rationale: mine data you already have first (low risk, fast value); spend
hardware / network / frozen-surface capital only after the software value is proven —
matching the owner's additive-module doctrine (`docs/design/program-plan.md` I.3).

## Shared conventions (all plans inherit)

- **Feature checklist** (`CLAUDE.md` §"Adding a new feature"): schema in `server/schema/*`
  → `npx drizzle-kit generate` → commit SQL → route in `server/routes/` registered in
  `server/app/routes.ts` → `src/lib/api.ts` fn + `src/types/` type → page/lazy route in
  `src/app/routes.tsx` → he+en keys in `locales/*.json` (parity) → audit kind added to the
  closed `AuditActionType` union in `server/lib/audit.ts` → bounded-enum telemetry on both
  client and `server/routes/realtime.ts` → `npx tsc --noEmit` clean.
- **Multi-tenancy:** every query filters `clinicId`. No exceptions.
- **Frozen surfaces (never weaken):** SSE transport + monotonic outbox cursor; no offline
  emergency queueing; no emergency endpoint in any cache; bounded-enum telemetry only;
  Strategy A authority safety net; `appointmentsPage.*` / `vt_appointments` /
  `/api/appointments` names. See `CLAUDE.md` §"Frozen architecture surfaces" +
  §"Operational doctrine".
- **i18n:** no hardcoded copy in `.ts/.tsx`; Hebrew-default, RTL-first.
- **Testing:** every code task ships or updates a test (`.cursor/rules/03-testing.mdc`).
- **Proof:** log verification evidence in `docs/audit/PROOF_ALIGNMENT_LOG.md` before
  claiming done.
