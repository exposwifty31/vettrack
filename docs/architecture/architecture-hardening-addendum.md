# VetTrack — Architecture Correction & Hardening Addendum

**Status:** Proposed governance layer (second pass)  
**Scope:** Enforcement, contracts, transactions, events, consistency, CI — not a replacement for `modularization-plan.md`  
**Invariant:** All policies below preserve current runtime behavior, API paths, queue names, and Phase 9 frozen surfaces unless changed via ADR.

**Tooling syntax:** Config examples below were reviewed against package CLIs/schemas on 2026-05-27. See [tooling-syntax-verification.md](./tooling-syntax-verification.md) for version-pinned, valid snippets before implementing G1–G7. **None of these tools are in `package.json` today** except a standalone `knip.json` (knip itself is not installed).

---

# 1. Architectural Fitness Functions

Fitness functions are **automated architectural assertions** that fail CI when the codebase drifts from agreed boundaries. VetTrack today has **`tsc`** and a **`knip.json`** file (knip is not yet a `devDependencies` entry). This addendum makes additional tools **mandatory, versioned, and merge-blocking** once installed (see verification doc).

## 1.1 Tooling stack

| Tool | Enforces | Merge policy |
|------|----------|--------------|
| **dependency-cruiser** | Layer boundaries, forbidden imports, orphan modules | **Block** on `error` severity |
| **madge** | Circular dependency graphs (`server/`, `src/`) | **Block** on new cycles; nightly reports on known cycles |
| **ESLint** (`eslint-plugin-import` / `eslint-plugin-boundaries`) | Import paths, no `server/` from `src/` | **Block** when rules enabled per directory |
| **knip** | Orphan exports, unused entry points | **Block** after install; baseline ratchet (no built-in PR diff) |
| **custom scripts** | `clinicId` query heuristics, route thinness, query-key registry | **Block** on P0 rules in touched paths |

**Why:** Human review cannot hold 55 route modules, 2k-line `api.ts`, and 100+ `eq(table.clinicId)` call sites. Entropy is the default; fitness functions make violations expensive immediately.

**Where CI fails:** GitHub Actions job `architecture-gates` (required check) runs on every PR to `main` and release branches. Nightly `architecture-audit` runs full-repo scans and posts a delta report (no block unless regression).

## 1.2 dependency-cruiser — concrete rules

Install: `dependency-cruiser@^17` (devDependency). CLI: **`depcruise`**. Init: `npx depcruise --init` → **`.dependency-cruiser.cjs`** (or ESM `dependency-cruiser.config.mjs` with `-c`).

**v17 rule schema:** `forbidden[]` entries have `from` / `to` only — **no top-level `via`**. `via` / `viaOnly` belong under `to` with `circular: true`. Use `to.reachable` for reachability rules.

```javascript
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-frontend-to-server",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^server/" },
    },
    {
      name: "no-server-to-frontend",
      severity: "error",
      from: { path: "^server/" },
      to: { path: "^src/" },
    },
    {
      name: "no-features-to-pages-internals",
      comment: "Features should not import arbitrary page modules during migration",
      severity: "warn",
      from: { path: "^src/features/[^/]+/" },
      to: { path: "^src/pages/[^/]+\\.tsx$", pathNot: "^src/pages/[^/]+/index\\.tsx$" },
    },
    {
      name: "no-route-db-in-new-code",
      comment: "New domain routes must not import db; legacy server/routes/*.ts grandfathered",
      severity: "error",
      from: { path: "^server/routes/domains/" },
      to: { path: "^server/db\\.js$" },
    },
    {
      name: "shared-is-framework-agnostic",
      severity: "error",
      from: { path: "^shared/" },
      to: { path: "^(server|src)/" },
    },
    {
      name: "no-circular",
      severity: "warn",
      from: { pathNot: "^node_modules" },
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: ["node_modules"] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
};
```

Barrel / re-export policy: enforce with **knip** (`exports` / `duplicates`) + code review, not invalid `dependencyTypes: ["reexport"]` rules. Integrations isolation: model with explicit `from`/`to` path rules or `allowed` lists — not top-level `via`.

**Grandfathering:** Existing `server/routes/*.ts` → `db` imports remain allowed via `pathNot` on legacy glob until slice retires each file (tracked in `docs/architecture/legacy-exceptions.json`).

## 1.3 madge CI

```bash
# PR gate — fail on ANY new cycle (separate trees; there is no server/src/)
npx madge --circular --extensions ts server > /tmp/cycles-server.txt
npx madge --circular --extensions ts,tsx src > /tmp/cycles-src.txt
# Compare against docs/architecture/baseline-cycles.json (custom script)
node scripts/architecture/compare-cycles.mjs /tmp/cycles-server.txt /tmp/cycles-src.txt
```

**Baseline (known, must not grow):**

- `server`: metrics ↔ redis ↔ display-heartbeat; jobs/enqueue ↔ chargeAlertWorker; clinical-check-in ↔ authority-cache
- `src`: `lib/api.ts` ↔ `lib/er-api.ts` (removal is Slice 1 — shrink baseline after fix)

**Policy:** New cycle = merge block. Shrinking baseline = required PR note + baseline file update.

## 1.4 ESLint import boundaries

Repo has **no** `eslint.config.*` today. **ESLint 10** requires **flat config** (`eslint.config.js`).

**Do not use `eslint-plugin-import@2.x` with ESLint 10** — peer range stops at `^9`. Use **`eslint-plugin-import-x`** (peer: `eslint ^8.57 || ^9 || ^10`) + **`typescript-eslint@^8`**.

Introduce scoped flat config blocks:

- `files: ["src/features/**/*.ts", "src/features/**/*.tsx"]` — `no-restricted-imports` or `import-x/no-restricted-paths` for page internals
- `files: ["server/routes/domains/**/*.ts"]` — forbid `db` / `drizzle-orm` except `*.repository.ts`

See [tooling-syntax-verification.md](./tooling-syntax-verification.md) for a full `eslint.config.js` skeleton. Restricted import `name` paths must match **relative paths from each file**, not copy-pasted `../db.js` literals.

## 1.5 Max file size & complexity

| Rule | Threshold | CI |
|------|-----------|-----|
| Route file (new / migrated) | ≤ 400 lines | error in `server/routes/domains/` |
| Service file | ≤ 700 lines (ADR-002 target) | warn >700, error >900 in `server/services/` |
| `src/lib/api/*.ts` module | ≤ 500 lines | error |
| `src/pages/*.tsx` | ≤ 800 lines (warn), ≤1200 (error) | warn/error |
| Cyclomatic complexity (eslint) | ≤ 25 per function in routes | warn |

Implement via `scripts/architecture/check-file-sizes.mjs` reading thresholds from `docs/architecture/thresholds.json`.

## 1.6 Orphan export detection

- **knip@6** (add to `devDependencies`; config schema: `https://unpkg.com/knip@6/schema.json`): run `knip` / `knip --production`; exit code follows `--max-issues` (default 0 = any issue fails).
- **No native PR-diff mode** — use baseline JSON diff script or full run with ratchet.
- **Policy:** Adding `export` requires same-PR consumer OR JSDoc tag (e.g. `/** @lintignore */`) listed in `knip.json` `tags: ["-lintignore"]` with ADR/issue link — not `knip-ignore-next-line` (not a Knip feature).

## 1.7 Barrel-export restrictions

**Forbidden:**

- `server/domain/index.ts` re-exporting all domains
- `src/lib/api/index.ts` re-exporting every namespace without tree-shake-friendly named exports
- `export * from` across domain boundaries

**Allowed:**

- Per-domain `index.ts` exporting only that domain's public surface (≤ 15 symbols)
- Temporary compatibility barrel at old path during migration (must list removal date in comment)

**Enforcement:** dependency-cruiser rule `no-barrel-reexport-cycles` + knip on barrel files.

## 1.8 Entropy prevention outcome

Contributors receive **immediate feedback** at authoring time (IDE ESLint) and **hard stop** at PR. Architectural debt becomes a tracked exception with owner and expiry, not silent rot.

---

# 2. Repository Layer Strategy

Repositories are **infrastructure adapters** over Drizzle — not a second domain model and not authorization layers.

## 2.1 Thin vs transactional repositories

| Type | Responsibility | Transaction |
|------|----------------|-------------|
| **Thin repository** | Single-table or narrow join CRUD; pure SQL/Drizzle | **Never** starts `db.transaction` |
| **Transactional repository** | Multi-table writes that are *only* persistence (no business rules) | Accepts `tx` as first parameter; **never** commits |

**Default:** thin repositories. Transactional repository modules are rare (e.g. outbox insert + ledger row) and must be listed in `docs/architecture/transactional-repositories.md`.

## 2.2 Who owns transactions

**Services own transaction boundaries.** Repositories receive `tx` when participating in a service transaction.

```
Route → Handler → Service.transaction(async (tx) => {
  repoA.update(clinicId, ..., tx);
  repoB.insert(clinicId, ..., tx);
  insertRealtimeDomainEvent(tx, ...);
}) → Handler maps result to HTTP
```

## 2.3 Repository responsibilities (allowed)

- Map rows ↔ DTOs (mapper colocated or `*.mapper.ts`)
- Encode `eq(table.clinicId, clinicId)` on **every** tenant table touch
- Encapsulate Drizzle query shapes (indexes, `isNull(deletedAt)` soft-delete defaults)
- Surface `23505` / constraint errors as typed `RepositoryConflictError` (no HTTP knowledge)

## 2.4 Forbidden repository behavior

- Resolving `clinicId` from `req`, Clerk, env, or `DEV_USER`
- Calling `logAudit` without `tx` when audit must align with write
- Enqueueing BullMQ jobs (service decides post-commit)
- Business rules: dose validation, idempotency key *derivation*, role checks
- Opening nested independent transactions
- Importing Express types or route handlers

## 2.5 clinicId enforcement policy

**Type-level convention:**

```typescript
export type TenantScope = { clinicId: string };

export async function findEquipmentById(
  scope: TenantScope,
  equipmentId: string,
  tx?: DbTx,
): Promise<EquipmentRow | null> {
  const { clinicId } = scope;
  return getDb(tx)
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.clinicId, clinicId), isNull(equipment.deletedAt)))
    .limit(1)
    .then(rows => rows[0] ?? null);
}
```

**Lint:** `scripts/architecture/tenant-query-lint.mjs` flags `.from(<table>)` in `server/**` without `clinicId` in the same function scope for tables in `TENANT_TABLES` registry (generated from `server/schema/`).

## 2.6 Recommended file layout

```
server/domain/equipment/
  equipment.repository.ts
  equipment.mapper.ts
  equipment.types.ts      # row DTOs, not HTTP shapes
server/domain/equipment/equipment.service.ts
```

Legacy `server/services/*.ts` may call repositories during migration; new code **must not** add raw `db` in services without repository justification in PR.

## 2.7 Rollback behavior

Repository methods do not catch transaction errors except to add context. Service layer:

- On domain validation failure → throw before `transaction`
- On `transaction` failure → propagate; route returns mapped status
- On partial outbox failure inside `tx` → full rollback (no fire-and-forget outbox inside clinical/financial transactions)

---

# 3. Transaction Boundary Policy

VetTrack mixes **synchronous clinical/financial commits**, **transactional outbox**, and **async inventory deduction**. Ambiguous transaction ownership causes double billing, lost events, or inventory drift.

## 3.1 Ownership matrix

| Layer | May `db.transaction`? | Notes |
|-------|-------------------------|-------|
| Route / handler | **Never** | Handler calls one service method per mutation |
| Repository | **Never** (except accepting `tx`) | |
| Service | **Yes** — primary owner | Orchestrates repos, outbox, idempotency |
| Worker processor | **Yes** — job-scoped unit | Idempotent job handlers |
| `logAudit` without `tx` | N/A | Fire-and-forget; **not** for mutations requiring audit+state atomicity |

## 3.2 Service-layer orchestration patterns

### Pattern A — Clinical/financial atomic unit

Used by: `completeTask`, dispense commit, billing ledger insert, equipment checkout with billing side-effects.

```typescript
await db.transaction(async (tx) => {
  const row = await billingRepo.insertLedger(scope, input, tx);
  await taskRepo.complete(scope, taskId, tx);
  await insertRealtimeDomainEvent(tx, { clinicId, type: "TASK_COMPLETED", payload });
  // audit with tx when must commit with domain write
  await logAudit({ ... }, tx);
});
// AFTER commit: enqueue inventory job (acceptable brief inconsistency per existing doctrine)
await inventoryQueue.enqueue({ ... });
```

### Pattern B — Outbox-required

Any mutation where rollback must **not** emit realtime events: `insertRealtimeDomainEvent` **inside** the same `tx` as state change.

### Pattern C — Async follow-up (inventory)

Documented invariant: billing/task state commits first; `vt_inventory_jobs` processed by worker. Recovery via `inventory-job-recovery.ts`. **Forbidden:** expecting inventory sync inside the HTTP response transaction unless explicitly spec'd.

## 3.3 Idempotent mutation guarantees

- **HTTP:** deterministic idempotency keys on billing (`vt_billing_ledger.idempotency_key`), container dispense middleware, equipment replay idempotency endpoints
- **Service:** on `23505` / unique violation → fetch existing or return success with same body (never 500 for duplicate)
- **Worker:** `jobId` deterministic (`plug-check-${returnId}`); processor must tolerate redelivery

**Forbidden:** idempotency check in route without service-level duplicate handling.

## 3.4 Async job enqueue timing

| Timing | When |
|--------|------|
| **After commit** | Inventory deduction, charge alerts, notifications — default |
| **Inside transaction** | Only when job row is part of consistency (e.g. `vt_inventory_jobs` insert as staging record) — must be same `tx` as domain write |
| **Before commit** | **Forbidden** for external side-effects (push, email, BullMQ publish that cannot roll back) |

## 3.5 Forbidden transaction patterns

- Route wraps `db.transaction` around service calls
- Service calls another service each opening its own transaction for one user action (split brain) — use one orchestrator or explicit saga ADR
- `insertRealtimeDomainEvent` after commit without compensating action on failure
- `await logAudit(...)` without `tx` on hot path where audit must match DB state
- Nested transactions relying on savepoints without ADR

## 3.6 Rollback guidance

On throw inside `tx`: no outbox row visible to publisher; client receives stable error code (`apiError` / domain error). Offline queue must not assume success unless server returned 2xx — sync engine retries per `RETRY_DELAYS_MS`.

---

# 4. Domain Event Strategy

Realtime today: `vt_event_outbox` + `insertRealtimeDomainEvent` + SSE. This addendum separates **domain events** (internal contract) from **transport events** (SSE payload).

## 4.1 Structure

```
server/domain/<domain>/events/
  <event-name>.v1.ts        # payload Zod schema + type
  index.ts                  # union DomainEvent for domain
shared/contracts/events/    # optional cross-tier read models (versioned)
```

**Internal domain event (example):**

```typescript
// server/domain/equipment/events/equipment-checked-out.v1.ts
export const EQUIPMENT_CHECKED_OUT = "equipment.checked_out.v1" as const;

export type EquipmentCheckedOutV1 = {
  type: typeof EQUIPMENT_CHECKED_OUT;
  clinicId: string;
  equipmentId: string;
  checkedOutById: string;
  occurredAt: string; // ISO — set by service, not client
};
```

**Transport mapping** (in `realtime-outbox` adapter):

```typescript
// Maps domain event → outbox type string (existing SSE contract)
// e.g. EQUIPMENT_CHECKED_OUT → "EQUIPMENT_STATUS_CHANGED"
```

Do **not** rename existing outbox `type` strings without ADR + client classifier update.

## 4.2 Event ownership

| Owner | Defines |
|-------|---------|
| Domain service | When event is emitted; payload content |
| Domain `events/*.v1.ts` | Schema + version suffix |
| Realtime lib | Persistence, cursor, replay, KEEPALIVE |
| Frontend `event-reducer` / classifiers | Bounded handling; telemetry enums |

## 4.3 Naming conventions

- Internal: `<domain>.<past-tense-action>.v<major>` — `medication.task_completed.v1`
- Outbox/SSE (frozen list): existing `QUEUE_SEVERITY_ESCALATED`, `ER_HANDOFF_SLA_BREACHED`, etc. — extend only via ADR
- Worker jobs: existing queue names — no rename

## 4.4 Versioning rules

- **Major** (`.v1` → `.v2`): breaking payload; dual-write or replay compatibility window required
- **Minor:** add optional fields only; consumers must ignore unknown keys
- **Telemetry:** bounded enum in `server/routes/realtime.ts` — parallel change mandatory

## 4.5 Transactional persistence

Domain service emits → `insertRealtimeDomainEvent(tx, { clinicId, type: TRANSPORT_TYPE, payload })` in **same transaction** as state change when loss on rollback is unacceptable (per `CLAUDE.md`).

## 4.6 Replay guarantees

- Monotonic `vt_event_outbox.id` cursor
- `Last-Event-ID` replay; pruned cursor → `reset_state:last_event_pruned` + full resync
- Domain events are **facts after commit**; replay is transport-level, not business re-execution

## 4.7 Anti-corruption

- Integrations must not publish directly to outbox with clinical types — map through integration service → domain event → outbox adapter
- Frontend must not invent outbox types; consume via `src/types/realtime-events.ts` and classifiers

## 4.8 Example event catalog (illustrative, non-exhaustive)

| Domain event | Typical transport type | Consumers |
|--------------|------------------------|-----------|
| `equipment.checked_out.v1` | existing equipment realtime | Ward, equipment caches |
| `medication.task_completed.v1` | task/med realtime | Tasks UI, billing views |
| `inventory.adjusted.v1` | inventory sync | Inventory pages, jobs dashboard |

---

# 5. Bounded Context Enforcement

Domains in `domain-boundaries.md` are **enforcement units**, not folder labels.

## 5.1 Dependency direction matrix

Rows may call **down** only (✓). ✗ = forbidden direct import / table access.

| From \ To | equipment | tasks | medication | inventory | billing | er | emergency | authority | integrations |
|-----------|:---------:|:-----:|:----------:|:---------:|:-------:|:--:|:---------:|:---------:|:------------:|
| **equipment** | ✓ | ✗ | ✗ | ✗ | via service API | ✗ | ✗ | via resolver | ✗ |
| **tasks** | ✗ | ✓ | via med svc | **via inventory svc** | via billing svc | ✗ | ✗ | via middleware | ✗ |
| **inventory** | ✗ | ✗ | ✗ | ✓ | via billing | ✗ | ✗ | ✗ | ✗ |
| **billing** | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **er** | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | via events | ✓ | ✗ |
| **emergency** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| **integrations** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

**Rule:** Cross-domain writes go through **owning service** or **shared application service** orchestrator — never `import { containers } from "../db"` inside `appointments.service.ts` for a direct `update`.

## 5.2 Contract-first communication

- **Synchronous:** service public functions with explicit `TenantScope` + typed inputs/outputs
- **Asynchronous:** outbox events + BullMQ jobs (existing queues)
- **Shared read models:** `shared/contracts/<domain>/` — versioned, no Drizzle imports

## 5.3 Database access restrictions

- Only `server/domain/<x>/*.repository.ts` (or legacy service during migration) may `from(vt_<x>_*)` for domain *x*
- **Exception:** reporting/analytics routes with read-only aggregates — ADR + read replica policy
- Tasks completing medication **must** call `inventory.service` / `completeTask` orchestration — not `db.update(vt_items)` inline

## 5.4 Boundary review checklist (PR)

- [ ] Does PR import another domain's repository? → reject or orchestrator ADR
- [ ] Does PR add `db` import to `server/routes/` (non-legacy)? → reject
- [ ] Does PR add outbox type without client classifier + telemetry enum?
- [ ] Does PR touch `vt_billing_ledger` without idempotency key path?

## 5.5 Anti-corruption layer

`server/integrations/` remains the template: vendor DTO → canonical contract → internal service. New vendors **must not** skip to Drizzle tables.

---

# 6. Frontend State Consistency Model

## 6.1 Authoritative hierarchy

```
1. Server committed state (PostgreSQL via successful API 2xx)
2. Realtime reconciliation (SSE outbox cursor → event-reducer → targeted invalidation)
3. TanStack Query cache (server-derived, TTL/staleTime policies)
4. Optimistic updates (mutation onMutate / local cache patch)
5. Offline replay queue (Dexie pendingSync — tentative until replay success)
```

**Higher layers override lower on confirmation; lower layers never override higher on conflict.**

## 6.2 Reconciliation order (reconnect / visibility)

1. `useRealtimeReconciliation`: replay from `Last-Event-ID` / HTTP replay endpoint
2. On `reset_state:last_event_pruned` → `forceResyncWardErCaches` (bounded)
3. Invalidate domain query keys per event classifier (not blanket `invalidateAll`)
4. Drain `pendingSync` FIFO (`sync-engine.ts`) — respect `CIRCUIT_THRESHOLD`
5. `offline-post-sync-reconciliation` hooks for equipment caches

**Forbidden:** polling Code Blue or emergency endpoints as primary recovery (Phase 9 doctrine).

## 6.3 Optimistic update rollback

- On mutation error: restore snapshot from `onMutate` context
- On 409 OCC: surface conflict UI; do not auto-merge without user action (`conflict-store`)
- Equipment PATCH: preserve `version` optimistic locking semantics

## 6.4 Replay conflict resolution

| Scenario | Resolution |
|----------|------------|
| Server wins (newer version) | Drop optimistic; refresh query |
| Offline queue duplicate checkout | `DEDUP_SYNC_TYPES` in `offline-db.ts` |
| Network false negative | Retry with same `idempotencyKey` / `clientMutationId` |
| Emergency mutation while offline | **Block** — never queue (`offline-emergency-block`) |

## 6.5 Cache invalidation ownership

| Owner | Keys |
|-------|------|
| Domain hook / feature | Primary query keys for that screen |
| `equipment-realtime.ts` | Equipment list/detail invalidation sets |
| `event-reducer.ts` | Maps transport event → invalidation spec |
| Global | **Avoid** — requires ADR |

**Registry:** `src/lib/query-keys/registry.ts` (to be introduced) — single source; CI compares new `useQuery({ queryKey:` literals against registry drift.

## 6.6 Stale data policies

- Operational dashboards: explicit `timeoutMs` (`EQUIPMENT_LIST_FETCH_TIMEOUT_MS`, `TASKS_FETCH_TIMEOUT_MS`)
- Display/kiosk: prefer realtime + snapshot endpoint over long `staleTime`
- Pilot stale equipment: `getPilotStaleMs()` — UI badges, not silent overwrite of server truth

## 6.7 Bug classes this prevents

- Double application of optimistic + replay (duplicate equipment state)
- Stale ER board after reconnect without replay
- Invalidating all queries on KEEPALIVE (forbidden — keepalive does not invalidate caches)
- Treating offline queue as source of truth after server reject

**Refactor rule:** Moving API modules must not change mutation `onSettled` / offline enqueue order without parity test.

---

# 7. `lib/` Entropy Prevention Rules

## 7.1 `server/lib/`

**Allowed:** infrastructure — redis, queues, postgresql, env, crypto, push transport, event publisher, rate limiters, metrics adapters, generic `audit.ts` writer, `apiError`, i18n middleware helpers, authority **wiring** (not clinical rules).

**Forbidden:** new domain rules (dose caps, billing calculations, ER escalation policy). Move to `server/domain/<x>/` or `server/services/<x>.service.ts`.

**Extraction trigger:** file > 500 lines AND contains `if (route ===` or `switch (taskType)` domain branching → split.

## 7.2 `src/lib/`

**Allowed:** `request()` core, auth-store, i18n accessor, sync-engine, offline-db, realtime client, pilot-mode flags, design tokens, chunk recovery.

**Forbidden:**

- New domain business rules in `lib/` (medication dose math belongs `utils/medicationCalculations` or feature)
- New god aggregators (`api.ts` adding 200 lines in one PR)
- Page-specific UI state in `lib/`

**Extraction trigger:** `lib/*.ts` imported by only one page → move to `features/<domain>/`.

## 7.3 Review heuristics

| Smell | Action |
|-------|--------|
| `lib/foo.ts` imports from `pages/` | Invert dependency |
| `server/lib` imports `routes/` | Forbidden |
| New `export *` barrel in `lib` | Require dependency-cruiser pass |
| Copy-pasted `clinicId` from `req` in lib | Move to handler/service |

---

# 8. ADR Governance

## 8.1 Location & format

- **Path:** `docs/architecture/adr/NNN-<slug>.md` (existing ADRs in `docs/architecture/adr-*.md` migrate numbering as encountered)
- **Template:**

```markdown
# ADR-NNN: Title
Date | Status (proposed/accepted/deprecated/superseded)
## Context
## Decision
## Consequences
## Compliance (fitness functions / migrations required)
```

## 8.2 Required ADR triggers (no merge without ADR reference in PR)

| Change | ADR |
|--------|-----|
| New domain boundary or cross-domain DB access | Required |
| New BullMQ queue or job payload shape change | Required |
| New/changed outbox SSE `type` or replay behavior | Required |
| Offline `PendingSyncType` or replay semantics | Required |
| Tenancy model (`clinicId` resolution, membership) | Required |
| Repository convention break (e.g. implicit tenancy) | Required |
| New external integration vendor | Required |
| Pilot mode route surface change | Required |
| Breaking shared contract in `shared/` | Required |

## 8.3 Lifecycle

1. **Proposed** — PR draft with ADR stub
2. **Accepted** — merged with implementing PR or immediately after
3. **Deprecated** — still documented, removal ticket linked
4. **Superseded** — link to replacement ADR

## 8.4 Lightweight process

- ADR PRs may be docs-only ≤ 1 day review
- Implementation PR links `ADR-NNN` in description
- Codex/connector review threads must be resolved before merge (existing `.cursorrules`)

## 8.5 Categories (mandatory tags)

`#tenancy` `#realtime` `#offline` `#clinical-safety` `#billing` `#integrations` `#frontend-state` `#worker`

---

# 9. CI Architecture Gates

## 9.1 Job: `architecture-gates` (required on PR)

| Step | Block? | Notes |
|------|--------|-------|
| `npx tsc --noEmit` | **Block** | Existing |
| `pnpm test` (unit) | **Block** | Existing vitest scope |
| `dependency-cruiser` | **Block** | New violations only if grandfather file used |
| `madge` cycle compare | **Block** on new cycle | |
| `knip` (changed files mode) | **Block** new orphans | |
| `scripts/architecture/tenant-query-lint.mjs` | **Block** on touched `server/` without waiver | |
| `scripts/architecture/check-file-sizes.mjs` | **Block** new files over limit | |
| Route contract snapshot | **Block** if path/method changes without `routes-contract.json` update | |
| Query key registry drift | **Warn** → **Block** after registry introduced | |

## 9.2 Job: `architecture-audit` (nightly)

| Step | Block? |
|------|--------|
| Full knip | Report |
| Full madge | Report regression |
| All route files db-import count | Trend |
| Top 20 file sizes | Trend |
| Tenant lint full repo | Report unscoped queries |
| i18n parity | **Block** on main if out of parity |

## 9.3 Route contract validation

Maintain `docs/architecture/routes-contract.json` generated by:

```bash
node scripts/architecture/extract-express-routes.mjs
```

PR diff fails if mount paths or HTTP methods change without intentional contract bump (version field in JSON).

## 9.4 Query key drift detection

```bash
node scripts/architecture/collect-query-keys.mjs
# diff against src/lib/query-keys/registry.ts
```

New literal `queryKey` not in registry → warn; registry is source of truth after adoption.

## 9.5 Tenant enforcement scan (heuristic)

```bash
rg '\.from\((\w+)\)' server/domain server/services server/routes \
  | node scripts/architecture/tenant-query-lint.mjs --stdin
```

Flags queries on tenant tables missing `clinicId` identifier in function body. False positives allowed via `// tenant-lint:scoped` with justification.

## 9.6 Merge policy summary

- **Block:** tenancy risk, new cycles, forbidden imports, broken route contracts, tsc, tests
- **Warn (grace 2 sprints):** file size overage in legacy files, query key drift
- **Nightly only:** entropy trends, full knip

---

# 10. Governance Rules for Future Contributors

## 10.1 Hard rules

1. **No new business logic in `src/pages/`** — pages compose features; >50 lines logic → extract hook/component
2. **Routes stay thin** — parse/validate/auth/delegate; no `db.transaction` in routes
3. **No new direct `db` imports in `server/routes/`** except legacy files on exception list with expiry date
4. **No implicit tenancy** — `clinicId` explicit parameter; never trust client body for tenant id
5. **No expanding `api.ts` monolith** — new endpoints go in `src/lib/api/<domain>.ts` + barrel re-export
6. **No cross-domain shortcuts** — see §5 matrix
7. **No emergency offline queue** — ever
8. **No new realtime transport** — SSE/outbox only
9. **No renaming** `appointmentsPage.*`, `/api/appointments`, internal table names for "tasks" rebranding
10. **Feature flags stay** — do not remove pilot/ER gates without ADR

## 10.2 Review checklist (architectural)

- [ ] ADR linked if trigger (§8.2)
- [ ] Transaction owner is service; outbox in `tx` when required
- [ ] Idempotency path for billing/dispense/equipment replay
- [ ] Tenant lint clean or waiver
- [ ] Frontend: query keys registered; optimistic rollback tested
- [ ] Workers: job id deterministic; processor idempotent
- [ ] Locales: `en`/`he` parity for new copy
- [ ] No Phase 9 frozen surface changed without explicit review label

## 10.3 Smell indicators (request changes)

- PR adds `import { db }` to route file
- PR adds `export *` barrel across domains
- PR adds `setInterval` for domain scheduling (use BullMQ / existing schedulers)
- PR adds `fetch()` in feature code bypassing `request()`
- PR invalidates `queryClient` globally on realtime event
- PR adds Hebrew user-facing string in `.tsx` source
- PR adds telemetry label not in closed enum union

## 10.4 Escalation triggers (staff review required)

- Any change to auth middleware order or `ROLE_HIERARCHY`
- Any change to medication volume bounds or duplicate open task constraint
- Any change to billing idempotency or ledger status enum
- Any change to outbox publisher timing or SSE endpoint
- Cross-domain orchestration touching ≥3 domains
- New Redis queue without `start-schedulers.ts` registration

## 10.5 Mandatory architectural review thresholds

| Metric | Threshold |
|--------|-----------|
| PR diff lines (server+src) | > 800 |
| Files touched across domains | ≥ 3 domain folders |
| New dependency on `server/workers` from routes | always |
| Schema migration | always + clinical enterprise integrity review |

## 10.6 Exception process

1. Add row to `docs/architecture/legacy-exceptions.json`:

```json
{
  "id": "route-equipment-db-2026Q2",
  "path": "server/routes/equipment.ts",
  "rule": "no-route-db",
  "owner": "@team",
  "expires": "2026-08-01",
  "issue": "https://github.com/.../issues/..."
}
```

2. CI allows violation only with valid, unexpired exception id in PR body  
3. Expired exception → merge block until resolved

---

## Implementation sequencing (governance only)

| Phase | Deliverable | Behavior impact |
|-------|-------------|-----------------|
| G1 | `dependency-cruiser` + baseline cycles JSON + CI job | None |
| G2 | ADR folder + template + PR template checkbox | None |
| G3 | Tenant lint script (warn mode) | None |
| G4 | Query key registry + drift script | None |
| G5 | Route contract extractor | None |
| G6 | Flip tenant lint + route-db rules to **block** on new paths | None on existing code |
| G7 | ESLint boundaries for `server/routes/domains` | None until migrations touch paths |

**This addendum does not authorize runtime refactors by itself** — it governs how modularization slices and future features land without eroding tenancy, clinical, or consistency guarantees.
