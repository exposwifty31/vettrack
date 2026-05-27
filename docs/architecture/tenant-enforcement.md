# Tenant enforcement invariants

`clinicId` is a **security boundary**. Cross-clinic access is a defect.

## Resolution order

1. **`requireAuth`** (`server/middleware/auth.ts`) — authoritative for protected routes; sets `req.authUser`, `req.clinicId`, role from **`vt_users.role`** (not JWT claims)
2. **`tenantContext`** (`server/middleware/tenant-context.ts`) — **best-effort** hint before handlers; does not replace `requireAuth`
3. **`ensure-user-clinic-membership`** — verifies user row matches `req.clinicId` where applied

## Query rules

- Every Drizzle query on tenant data must constrain the **target table** with `eq(<table>.clinicId, clinicId)` (or equivalent), not only via joins
- Never hardcode `dev-clinic-default` in production-only paths (dev-bypass only)
- New `pgTable` definitions: `clinicId` NOT NULL, immediately after PK (match `server/schema/` neighbors)

## Repository pattern (target)

When introducing `*.repository.ts`:

```ts
// clinicId is always the first parameter after any tx handle
async function findById(clinicId: string, id: string, tx?: DbTx) { ... }
```

Code review checklist for each new repository method:

- [ ] `clinicId` parameter required (non-optional)
- [ ] WHERE includes `eq(table.clinicId, clinicId)` on the row being read/written
- [ ] No query uses only join-derived tenancy without filtering the target table

## Idempotency and dispense

- Container dispense idempotency keys are scoped by `(clinicId, key)` — see `container-dispense-idempotency.ts`
- Billing ledger: `idempotency_key` unique per clinic semantics in services

## Auth middleware order

Do not reorder without regression plan (`server/index.ts`):

Health bypass → helmet/CORS → JSON+XSS → Clerk → i18n → tenant → ER concealment → session context → `/api` routes

## Refactor hazards

- Extracting handlers/services from fat routes: easy to drop `clinicId` on a new query
- Barrel exports that hide `clinicId` parameters
- Tests that mock `req.clinicId` without asserting DB filters

## Verification

```bash
# After touching tenant data paths
rg 'eq\([^)]+\.clinicId' server/path/you/changed
pnpm tenant:lint:touched   # G3 heuristic — warn only; see scripts/architecture/tenant-query-lint.mjs
npx tsc --noEmit
```

### Tenant query lint (G3, warn mode)

`scripts/architecture/tenant-query-lint.mjs` scans Drizzle `.from(<table>)` calls for tables in the schema-derived **TENANT_TABLES** registry (`server/schema/*.ts` with a `clinicId` column). It warns when the enclosing function body lacks a `clinicId` identifier or `<table>.clinicId` reference.

False positives: waive with `// tenant-lint:scoped <reason>` on the same line or the line above the `.from(...)` call.

CI runs this in **warn-only** mode on touched `server/` paths (non-blocking). Future G6 may enable `--strict` for merge-blocking on new paths.
