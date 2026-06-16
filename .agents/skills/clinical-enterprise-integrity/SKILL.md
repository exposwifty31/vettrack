---
name: clinical-enterprise-integrity
description: Audits VetTrack changes for offline-first safety, equipment/inventory alignment, critical bedside workflows, and audit/RBAC integrity. Use when reviewing equipment, waitlist, dispense, inventory, BullMQ workers, PWA sync, Code Blue, ward board, integrations, or deployment readiness.
---

# Clinical enterprise integrity (VetTrack)

Treat VetTrack as a **clinical-grade operational layer**: 24/7 hospital use requires synchronized asset and inventory state — no silent loss on connectivity drops.

## Quick start

1. Read `CONTEXT.md` and [`docs/scope-change-2026.md`](../../docs/scope-change-2026.md) for current product scope.
2. Classify findings **P0–P4** (severity, file:line, risk, effort).
3. Deep checklists: [REFERENCE.md](REFERENCE.md).

## Workflow A — Equipment & inventory sync

Trace checkout/return, waitlist promotion, or dispense end-to-end:

- API handler → service → DB — same `clinicId`, audit where required.
- Integration adapters stay under `server/integrations/`.

## Workflow B — Offline-first & workers

- Client: `src/lib/offline-db.ts`, `sync-engine.ts` — failed sync must surface to the user.
- Server: `server/jobs/runtime.ts`, `server/app/start-schedulers.ts` — idempotent jobs, tenant scoping.

## Workflow C — Critical workflows (Code Blue, ward board)

- **Ward board:** `/equipment/board` — SSE-driven; see [`docs/architecture/offline-realtime-invariants.md`](../../docs/architecture/offline-realtime-invariants.md).
- **Code Blue:** online-only mutations; full-screen takeover; no nested navigation during active session.

## Workflow D — Audit trail & RBAC

- `logAudit()` from `server/lib/audit.ts`; role from `vt_users.role` in DB.

## Removed (do not audit as live)

ER Mode allowlist, medication tasks, formulary, async inventory-deduction billing — removed in migrations 142–143.
