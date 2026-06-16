# VetTrack — canonical context (`CONTEXT.md`)

Single source of **domain language and non-negotiable rules** for VetTrack’s operational/clinical surfaces. Align new features with this glossary before implementation.

---

## Glossary (current product)

**Equipment operational state**  
Multi-axis state on `vt_equipment`: custody, readiness, usage, staging, and condition checks. Drives ward board, alerts, and waitlist eligibility.

**Equipment waitlist**  
Clinic-scoped queue (`vt_equipment_waitlist`) when demand exceeds available units. Promotion on return, dock-return, or reservation TTL — not on advisory ETA fields alone.

**Reservation TTL**  
After waitlist promotion, `reservationExpiresAt` bounds how long the promoted user has to claim the asset.

**Staging queue**  
Pre-use holding area (`vt_staging_queue`) with clinical priority and expiry workers.

**Asset Copilot**  
Explain-only assistant on equipment detail: `POST /api/equipment/:id/copilot/explain`. Orchestrator in `server/services/asset-copilot-orchestrator.service.ts`.

**Tasks (unified model)**  
Staff-facing **Tasks / משימות** on `vt_appointments`, canonical route `/equipment/tasks`. Internal API/table names stay `appointments` (Phase 6 §17).

**Code Blue session**  
Equipment-centric emergency log (`vt_code_blue_sessions`, log entries, presence). No patient/hospitalization FKs after migration 142.

**Ward board**  
Live display at `/equipment/board` (`/api/display/snapshot`). SSE-driven; never cached in service worker.

**Dispense**  
Cabinet dispense events (`vt_dispense_events`). Orphan-vs-order validation in `server/lib/dispense-order-validation.ts` currently returns no blocks (medication appointment path removed).

**Smart COP / enforcement**  
Evaluator families under `server/lib/authority/enforcement/*` with per-clinic `off | shadow | enforce`. Strategy A (shift-derived authority) remains the safety net for clinics without clinical check-in.

**Multi-tenancy**  
`clinicId` is a security boundary on every tenant table query — filter the target table, not only joins.

**Offline-first**  
Dexie cache + sync engine for operational mutations. **Code Blue mutations never queue offline** — fail loud via `src/lib/offline-emergency-block.ts`.

---

## Frozen architecture (do not replace)

- SSE realtime + outbox cursor (`/api/realtime/stream`, `vt_event_outbox`)
- PWA build-tag + emergency endpoint SW denylist
- Code Blue server-confirmed session end (no optimistic local terminate)
- Bounded telemetry enums only (`POST /api/realtime/telemetry`)
- `appointmentsPage.*` i18n namespace (copy says Tasks; keys unchanged)

---

## Removed domains (do not reintroduce without explicit product decision)

Documented in [`docs/scope-change-2026.md`](docs/scope-change-2026.md):

- ER Mode, ER board, intake routing, shift handover product surface
- Patients / animals / hospitalizations as first-class UI
- Medication tasks, drug formulary, pharmacy forecast
- Pilot mode route gating
- Async inventory-deduction billing worker (stub only)

Legacy SPA paths redirect to `/equipment` or `/equipment/tasks`.

---

## Auth & roles

- Runtime role from `vt_users.role` in DB (not JWT).
- Hierarchy (numeric): `admin` 40 · `vet` 30 · `senior_technician` 25 · `lead_technician` 22 · `vet_tech` / `technician` 20 · `student` 10.

---

## i18n

Hebrew default (`locales/he.json`). User-facing strings only in locale JSON — not in identifiers or source literals. Parity enforced across `en` and `he`.
