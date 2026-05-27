# Domain boundaries

Canonical product language lives in `CONTEXT.md`. Internal names (e.g. `appointments`, `vt_appointments`) are **frozen** where Phase 6/9 docs say so; only user-facing copy uses "Tasks / משימות".

## Domain map

| Domain ID | Repository surfaces | Owns |
|-----------|---------------------|------|
| `equipment` | `routes/equipment*`, equipment services, RFID, staging, waitlist | Asset checkout/return, scan logs, operational state |
| `tasks` | `appointments`, `tasks`, `medication-tasks` routes/services | Unified task model (scheduling + lifecycle + med execution) |
| `medication` | formulary, medication-calculation, calculator UI | Dose safety, formulary |
| `inventory` | containers, restock, inventory-items, procurement, deduction worker | Stock, async inventory jobs |
| `billing` | billing route, ledger libs | Financial records, idempotency keys |
| `er` | `er`, `er-admin`, ER services, `shared/er-types.ts` | ER Mode, intake, board, handoff |
| `emergency` | code-blue, crash-cart, display | Code Blue, ward display — **frozen** |
| `authority` | clinical-check-in, task-ownership, `lib/authority/enforcement/*` | Check-in, evaluators `off \| shadow \| enforce` |
| `scheduling` | shifts, shift-handover, patient-handoffs, shift-chat | Shift operations |
| `patients` | patients, animals | Patient/owner records |
| `integrations` | `server/integrations/*` | PMS adapters, webhooks — reference boundary |
| `realtime` | realtime route, event-publisher, outbox | SSE, cursor, replay |
| `offline` | offline-db, sync-engine, api offline options | Dexie queue, replay |
| `platform` | users, auth, pilot, admin-*, metrics | Tenancy, ops tooling |

## Cross-cutting (not domains)

- i18n (`locales/`, `lib/i18n`)
- Audit (`logAudit`, closed `AuditActionType` union)
- Feature flags / pilot mode
- Rate limiting, XSS sanitization, Helmet CSP

## Target folder layout (incremental)

```
server/routes/domains/<domain>/   # router + handlers + validation
server/domain/<domain>/           # service + repository + mapper (optional; parallel to services/)
server/schema/<domain>.ts         # existing — do not duplicate
server/integrations/              # keep as-is

src/features/<domain>/            # api, hooks, components, pages
src/lib/api/<domain>.ts           # extract from monolithic api.ts
shared/contracts/<domain>/        # optional; root re-exports during migration
```

## Dependency rules

- **Routes** may call handlers → services/repositories; must not import frontend code
- **Services** take `clinicId` as an explicit parameter; no env-based tenant resolution inside services
- **Shared** must not import `server/` or `src/`
- **Features** import `lib/api` or feature-local api wrappers — never `server/`

## Coupling hotspots (extract last or with extra care)

1. `server/routes/equipment.ts` — push, audit, charge-alert worker, waitlist, replay idempotency
2. `server/services/appointments.service.ts` — billing + inventory + medication (ADR-002)
3. `src/lib/api.ts` + `src/pages/equipment-detail.tsx` — offline cache + realtime
4. Pilot-gated route registration in `server/app/routes.ts`
