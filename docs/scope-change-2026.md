# Product scope change (June 2026)

Migrations **142** and **143** narrowed VetTrack to an **equipment-first** hospital operations platform. ER module, patient/animal records, medication tasks, drug formulary, and pharmacy forecast were removed from the schema and UI.

## Migrations

| Migration | Removed |
|-----------|---------|
| [142_drop_er_patients_shift_handover.sql](../migrations/142_drop_er_patients_shift_handover.sql) | ER board/intake/handover tables, `vt_animals` / `vt_owners` / `vt_hospitalizations`, patient FKs on appointments and Code Blue |
| [143_drop_medication_pharmacy_forecast.sql](../migrations/143_drop_medication_pharmacy_forecast.sql) | `vt_medication_tasks`, `vt_drug_formulary`, pharmacy forecast tables |

## What remains (document these)

- **Equipment:** lifecycle, operational state, waitlist, staging, docks, rooms/radar, RFID, WhatsApp alerts
- **Asset Copilot:** `POST /api/equipment/:id/copilot/explain`
- **Tasks:** unified model on `vt_appointments` at `/equipment/tasks` (user-facing copy: Tasks / משימות)
- **Code Blue + crash cart + ward board:** `/code-blue`, `/code-blue/display`, `/equipment/board`
- **Inventory:** containers, restock, dispense, procurement
- **Shifts, shift chat, clinical check-in, authority evaluators**
- **Integrations, push, SSE realtime, PWA offline-first**
- **Native Capacitor shell** (see [mobile/README.md](./mobile/README.md))

## Disabled / stubbed paths (do not document as live)

| Surface | Status |
|---------|--------|
| `pnpm sync:formulary` | **Removed** — formulary dropped |
| `server/workers/inventory-deduction.worker.ts` | **No-op stub** — async billing/inventory jobs removed |
| `evaluateDispenseAgainstOrders` | **Returns empty** — orphan dispense enforcement from appointments disabled |
| Pilot mode (`src/lib/pilot-mode.ts`) | **Deleted** — all routes registered unconditionally |

## Legacy SPA redirects

Removed pages redirect in [`src/app/routes.tsx`](../src/app/routes.tsx):

| Old path | Redirects to |
|----------|--------------|
| `/appointments`, `/meds`, `/pharmacy-forecast` | `/equipment/tasks` |
| `/display`, `/equipment-board` | `/equipment/board` |
| `/patients`, `/patients/:id`, `/pending`, `/pending-emergencies` | `/equipment` |
| `/billing`, `/billing/:rest*` | `/equipment` |
| `/er`, `/er/:rest*`, `/shift-handover` | `/equipment` |
| `/stability`, `/app-tour` | `/home` |
| `/admin/medication-integrity` | `/admin` |

Canonical equipment paths: `/equipment`, `/equipment/tasks`, `/equipment/board`.

## API route count

~**44** route modules in [`server/app/routes.ts`](../server/app/routes.ts); `webhooks` and `rfid` also mount from [`server/index.ts`](../server/index.ts). Regenerate inventory: `pnpm docs:audit`.
