# Zod .strict() schema audit (PR-15 / VA-01)

> **Historical snapshot — partial obsolescence (post migrations 142–143, June 2026).** Rows for `/api/medication-tasks`, medication inventory, ER/patient routes, and formulary fields describe **removed** surfaces. Do not treat them as live API contracts. For current scope see [`scope-change-2026.md`](./scope-change-2026.md). For today's routes run `pnpm docs:audit` → [`audit/routes.md`](./audit/routes.md). Re-audit dispense, code-blue, equipment, and tasks rows against current `server/routes/` before relying on YES/NO columns.

**Generated:** 2026-05-21  
**Source commits:** PR-15 (`ca2439cc`), PR-16 (`928f512f`)  
**Auditor:** Composer 2.5  
**Scope:** every `.strict()` schema in `server/routes/*.ts` at PR-15/16 (27 schemas). Client comparison uses `src/lib/api.ts` and direct `authFetch` call sites in `src/` on the audited tree.

## Method

1. Enumerate every `z.object({...}).strict()` schema in `server/routes` (via `git grep '\.strict()'` on `928f512f` plus `clinical-check-in.ts` / `restock.ts` already on `main`).
2. Identify the route handler consuming each (`validateBody` or `safeParse` on POST/PATCH/PUT).
3. Locate the matching client builder in `src/lib/api.ts` or an inline `authFetch` / `request` caller in `src/`.
4. Compare keys: builder must send **only** keys declared in the schema (subset of declared keys is OK; extra keys are a **NO**).

## Schema → client builder map

| Route | Schema | Builder (src/lib/api.ts) | Builder location | Sends only declared fields? | Risk |
|-------|--------|--------------------------|------------------|------------------------------|------|
| POST /api/dispense/draft | `draftSchema` | — (no `api.dispense`; not in `api.ts`) | — | UNKNOWN | med |
| POST /api/dispense/:id/confirm | `confirmSchema` | — (no body builder; route has no `validateBody`) | — | UNKNOWN | med |
| POST /api/dispense/emergency | `emergencySchema` | — (no `api.dispense`; not in `api.ts`) | — | UNKNOWN | med |
| POST /api/medication-tasks | `createTaskSchema` | — (no client wrapper) | — | UNKNOWN | med |
| POST /api/medication-tasks/:id/complete | `completeTaskSchema` | — (staff UI uses `api.tasks.complete` → `/api/tasks/:id/complete`, not this route) | — | UNKNOWN | med |
| POST /api/medication-tasks/:id/cancel | `cancelTaskSchema` | — (no client wrapper) | — | UNKNOWN | med |
| POST /api/code-blue/events | `startSchema` | `api.codeBlue.startEvent` | api.ts:1741 | YES | low |
| PATCH /api/code-blue/events/:id | `endSchema` | `api.codeBlue.endEvent` | api.ts:1746 | YES | low |
| POST /api/code-blue/sessions | `startSessionSchema` | Inline `authFetch` in `src/pages/code-blue.tsx` | code-blue.tsx:518–528 | YES (remediated `f9489c90`) | low |
| POST /api/code-blue/sessions/:id/logs | `logEntrySchema` | Inline `authFetch` via `useCodeBlueSession.logEntry` | useCodeBlueSession.ts:130–169 | YES | low |
| PATCH /api/code-blue/sessions/:id/end | `endSessionSchema` | Inline `authFetch` in `src/pages/code-blue.tsx` | code-blue.tsx:325–328 | YES | low |
| PATCH /api/code-blue/sessions/:id/reconcile | `reconcileSchema` | `api.codeBlue.reconcile` | api.ts:1757 | YES | low |
| POST /api/code-blue/sessions/:id/manual-billing | `manualBillingSchema` | `api.codeBlue.manualBilling` | api.ts:1759 | YES | low |
| POST /api/billing | `createChargeSchema` | `api.billing.create` | api.ts:1501 | YES | low |
| POST /api/billing/:id/reverse | `reverseChargeSchema` | — (no caller in `src/`) | — | UNKNOWN | med |
| POST /api/billing/leakage-report/one-pager | `leakageOnePagerSchema` | — (no caller in `src/`) | — | UNKNOWN | med |
| PATCH /api/billing/bulk-sync | `bulkSyncSchema` | `api.billing.bulkSync` | api.ts:1510 | YES | low |
| POST /api/inventory-items | `createItemSchema` | `api.inventoryItems.create` | api.ts:1536 | YES | low |
| PATCH /api/inventory-items/:id | `updateItemSchema` | `api.inventoryItems.update` | api.ts:1538 | YES | low |
| POST /api/inventory-items/:id/prices | `addPriceSchema` | — (no caller in `src/`) | — | UNKNOWN | med |
| POST /api/procurement | `createPoSchema` | `api.procurement.create` | api.ts:1550 | YES | low |
| PATCH /api/procurement/:id/receive | `receivePoSchema` | `api.procurement.receive` | api.ts:1556 | YES | low |
| POST /api/equipment/:id/checkout | `checkoutSchema` | `api.equipment.checkout` | api.ts:829 | YES | low |
| POST /api/equipment/:id/scan | `scanSchema` | `api.equipment.scan` | api.ts:764 | YES (remediated `f9489c90`) | low |
| POST /api/restock/scan | `scanSchema` (restock) | `api.restock.scan` | api.ts:1458 | YES | low |
| POST /api/clinical/check-in | `checkInBodySchema` | — (no caller in `src/`) | — | UNKNOWN | med |
| POST /api/clinical/check-ins/:id/admin-force-close | `forceCloseBodySchema` | — (no caller in `src/`) | — | UNKNOWN | med |

### Schema keys (declared) vs builder keys (sent)

<details>
<summary>Per-schema key reference</summary>

**dispense — `itemSchema` (nested):** `itemId`, `quantity`

- **draftSchema:** `containerId`, `patientId?`, `items[]`
- **confirmSchema:** _(empty object)_
- **emergencySchema:** `containerId`, `patientId?`, `items[]`, `bypassReason`

**medication-tasks**

- **createTaskSchema:** `animalId`, `drugId`, `route`, `calculationInput` `{ weightKg, prescribedDosePerKg, doseUnit, concentrationMgPerMl? }`, `overrideReason?`, `reasonType?`, `dueAt?`
- **completeTaskSchema:** `actualVolume`, `administeredAt?`
- **cancelTaskSchema:** `reason?`

**code-blue**

- **startSchema:** `localStartedAt?`
- **endSchema:** `outcome?`, `notes?`, `timeline?[]`
- **startSessionSchema:** `managerUserId`, `managerUserName`, `patientId?`, `hospitalizationId?`, `preCheckPassed?`, `localStartedAt?`, `idempotencyKey?` (accepted, not persisted on start)
- **logEntrySchema:** `idempotencyKey`, `elapsedMs`, `label`, `category`, `equipmentId?`
- **endSessionSchema:** `outcome`, `earlyStopReason?`
- **reconcileSchema:** `forceReason?`
- **manualBillingSchema:** `inventoryLogId`, `itemId`, `quantity`, `unitPriceCents`, `animalId?`, `resolveTaskId?`

**billing**

- **createChargeSchema:** `animalId?`, `itemType`, `itemId`, `quantity`, `unitPriceCents`, `note?`, `idempotencyKeyHint?`
- **reverseChargeSchema:** `reversalReason`
- **leakageOnePagerSchema:** `summary` `{ totalGapValueCents, totalGapQty, totalDispensedQty?, totalBilledQty?, overallLeakagePct? }`, `eventsCount?`, `periodDays?`, `shift?`, `primaryEquipment?`, `topContributor?`
- **bulkSyncSchema:** `ids[]`

**inventory-items**

- **createItemSchema:** `code`, `label`, `itemType` (default), `unit?`, `category?`, `nfcTagId?`, `formularyId?`
- **updateItemSchema:** `label?`, `itemType?`, `unit?`, `category?`, `nfcTagId?`, `isBillable?`, `minimumDispenseToCapture?`, `formularyId?`
- **addPriceSchema:** `contextType`, `contextId?`, `priceCents`, `currency` (default), `effectiveFrom?`

**procurement**

- **createPoSchema:** `supplierName`, `lines[]` `{ itemId, quantityOrdered, unitPriceCents? }`, `notes?`
- **receivePoSchema:** `lines[]` `{ lineId, quantityReceived, containerId }`

**equipment**

- **checkoutSchema:** `location?`
- **scanSchema:** `status`, `note?`, `photoUrl?`

**restock**

- **scanSchema:** `sessionId`, `itemId?`, `nfcTagId?`, `observedQuantity`

**clinical-check-in**

- **checkInBodySchema:** `operationalRole?`
- **forceCloseBodySchema:** `reason?`

</details>

## Findings

### No mismatches found

- **startSchema** — `api.codeBlue.startEvent` sends only `localStartedAt?` (matches). No live `src/` caller found; builder is correct if used.
- **endSchema** — `api.codeBlue.endEvent` sends `outcome?`, `notes?`, `timeline?` (matches). No live `src/` caller found.
- **logEntrySchema** — `useCodeBlueSession` sends `idempotencyKey`, `elapsedMs`, `label`, `category`, optional `equipmentId`.
- **endSessionSchema** — `code-blue.tsx` sends `{ outcome }` only (valid subset).
- **reconcileSchema** — `api.codeBlue.reconcile` PATCH with no body (`{}` valid).
- **manualBillingSchema** — `api.codeBlue.manualBilling` sends `inventoryLogId`, `itemId`, `quantity`, `unitPriceCents`, optional `animalId` (subset of schema).
- **createChargeSchema** — `api.billing.create` from `billing-ledger.tsx` sends declared subset only.
- **bulkSyncSchema** — `api.billing.bulkSync` sends `{ ids }` only (no UI caller yet; builder is correct).
- **createItemSchema** / **updateItemSchema** — `inventory-items.tsx` via `api.inventoryItems.*` (subset of optional fields).
- **createPoSchema** / **receivePoSchema** — `procurement.tsx` via `api.procurement.*`.
- **checkoutSchema** — `api.equipment.checkout` sends `{ location }` only (`undefined` omitted by `JSON.stringify`).
- **restock scanSchema** — `api.restock.scan` sends `sessionId` + spread `params` (`itemId?`, `nfcTagId?`, `observedQuantity`); contract covered by `tests/restock-payload-contract.test.ts`.

### Mismatches found (require action)

_(Remediated on `claude/audit-remediation-implementation-keLcH` in **`f9489c90`** — `fix(validation): reconcile strict schema mismatches found in H4 audit`.)_

- ~~**startSessionSchema**~~ — added optional `idempotencyKey` to schema (not persisted; log entries use their own keys).
- ~~**scanSchema** (equipment)~~ — `api.equipment.scan` sends only `status` / `note` / `photoUrl`; actor from `requireAuth`. **Migration note:** offline-queued scan requests in user IndexedDB that include legacy `userId`/`userEmail` fields will receive 400 on replay after merge. Failures surface via the PR-24 sync toast. Users can retry the scan; the new wire body omits identity fields (server uses the authenticated session).

### Could not determine (no builder located)

- **draftSchema**, **emergencySchema** — no `src/lib/api.ts` helper and no `src/` references to `/api/dispense/*`. Container dispense uses `/api/containers/:id/dispense` (different route module). **Action:** monitor Sentry for 400 `INVALID_BODY` / Zod errors on `/api/dispense/*` for 7 days; add `api.dispense` builders when UI is wired.
- **confirmSchema** — exported and tested in PR-16, but `POST /api/dispense/:id/confirm` does not call `validateBody(confirmSchema)` on the route (body not validated). **Action:** wire `validateBody(confirmSchema)` on confirm; monitor 400s after merge.
- **createTaskSchema**, **completeTaskSchema**, **cancelTaskSchema** — no frontend client; likely server/integration-only today. **Action:** monitor `/api/medication-tasks` 400 rate; add typed `api.medicationTasks.*` when bedside UI calls these routes.
- **reverseChargeSchema** — no `src/` caller for `POST /api/billing/:id/reverse`. **Action:** monitor admin billing flows; add builder when reverse UI ships.
- **leakageOnePagerSchema** — no `src/` caller for `POST /api/billing/leakage-report/one-pager` (leakage UI uses GET `api.billing.leakageReport`). **Action:** monitor endpoint; low traffic expected until one-pager UI exists.
- **addPriceSchema** — no inventory price UI in `src/`. **Action:** monitor `POST /api/inventory-items/:id/prices`.
- **checkInBodySchema**, **forceCloseBodySchema** — no `src/` references to `/api/clinical/*`. **Action:** monitor clinical check-in 400s when mobile/check-in UI lands.

### Related note (not a client mismatch)

Staff medication completion uses `api.tasks.complete` → `POST /api/tasks/:id/complete` with `{ execution? }`, not `POST /api/medication-tasks/:id/complete` (`completeTaskSchema`). Treat as separate contract.

## Open follow-up actions

- [x] H4 mismatches (`startSessionSchema`, equipment `scanSchema`) — fixed in `f9489c90`.
- [ ] For each "Could not determine" row: monitor for 400s in Sentry for 7 days; if no spikes, downgrade risk to low.
- [ ] Wire `validateBody(confirmSchema)` on `POST /api/dispense/:id/confirm` if empty-body strictness is required.
- [ ] After PR-15 merges to `main`, re-run `grep '\.strict()' server/routes/` and confirm this table matches production routes.
