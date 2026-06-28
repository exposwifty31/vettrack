# REPO_MOVE_PLAN.md

> **Phase 3 — Repository move plan.**
> **File moves only. No code rewrites.** Every move:
> 1. preserves git history (`git mv`, history follows with `--follow`),
> 2. preserves imports initially (a temporary re-export shim at the old path),
> 3. introduces no behavioral change.
>
> Notation: `OLD/PATH  →  NEW/PATH`. A shim is a 1-line `export * from "<new>"` (or default re-export)
> left at `OLD/PATH` so existing importers keep compiling; shims are deleted in `MIGRATION_SEQUENCE.md`'s
> cleanup step **after** importers are repointed. Moves are grouped by domain in dependency order
> (shared → security → infra → domains → workers → apps → tests → tooling).

---

## 0. Mechanics (apply to every move)

```bash
# 1. move with history
git mv OLD/PATH NEW/PATH
# 2. leave a compat shim so nothing breaks yet
printf 'export * from "%s";\n' "NEW_IMPORT_SPECIFIER" > OLD/PATH   # (for type-only files: export type *)
# 3. tsc must stay green BEFORE committing the batch
npx tsc --noEmit
```
- Add `paths` aliases in `tsconfig.json` for new roots (`@shared/*`, `@native/*`, `@desktop/*`,
  `@offline/*`, `@backend/*`, `@workers/*`) so new code imports the new path while shims cover the old.
- One commit per move-batch (per section below), each independently revertable.
- **Never** move a FROZEN file's *contents*; only relocate the file + shim. SW (`public/sw.js`), realtime
  transport, emergency-block, outbox publisher, build-tag injection stay byte-for-byte.

---

## 1. shared/ kernel (lowest risk — do first)

```
src/core/entities/*                  ->  domains/shared/entities/*
src/core/use-cases/*                 ->  domains/shared/use-cases/*
src/core/ports/index.ts              ->  domains/shared/ports/index.ts
src/core/index.ts                    ->  domains/shared/index.ts
src/lib/routes/**                    ->  domains/shared/routes/**          # nav-model = SSoT
src/types/**                         ->  domains/shared/contracts/**
shared/*.ts (top level)              ->  domains/shared/entities/*         # authority, permissions, equipment-truth, …
shared/contracts/**                  ->  domains/shared/contracts/**
lib/i18n/**                          ->  domains/shared/i18n/**
```
- Shim every old path. Keep top-level `shared/` re-exporting from `domains/shared` until server + client
  importers are repointed (the existing `shared-is-framework-agnostic` cruiser rule already guards it).
- **Risk:** import churn only. **Rollback:** revert the batch commit; shims make this atomic.
- **Verify:** `npx tsc --noEmit`; `pnpm test` i18n-parity + no-hebrew-in-source stay green.

---

## 2. backend/security/ (carve the boundary subtree)

```
server/middleware/auth.ts                    ->  server/security/authn/auth.middleware.ts        # CODEOWNERS-protected
server/lib/clerk-session-auth.ts             ->  server/security/authn/clerk-session-auth.ts
server/lib/clerk-*.ts                         ->  server/security/authn/*
server/lib/auth-mode.ts                       ->  server/security/authn/auth-mode.ts
server/lib/admin-email-allowlist.ts           ->  server/security/authn/admin-email-allowlist.ts
server/lib/stability-token.ts, stability-log.ts -> server/security/authn/*
server/lib/apple-auth.ts                      ->  server/security/authn/apple-auth.ts
server/middleware/authority.ts               ->  server/security/authz/authority.middleware.ts
server/lib/authority.ts                       ->  server/security/authz/authority.ts              # resolveAuthority — the ONE resolver
server/lib/authority-*.ts                     ->  server/security/authz/*
server/lib/role-resolution.ts                 ->  server/security/authz/role-resolution.ts
server/lib/{access-denied,er-mode-permissions,task-rbac}.ts -> server/security/authz/*
server/lib/authority/**                       ->  server/security/policies/**                     # off|shadow|enforce
server/lib/audit.ts                           ->  server/security/audit/audit.ts                  # closed AuditActionType union
server/lib/authority-audit.ts                 ->  server/security/audit/authority-audit.ts
server/lib/config-crypto.ts                   ->  server/security/audit/config-crypto.ts
server/middleware/tenant-context.ts          ->  server/security/tenancy/tenant-context.ts
server/middleware/ensure-user-clinic-membership.ts -> server/security/tenancy/*
```
- **Keep `server/security/` inside the existing `server/` tree** (not a top-level `security/`) so Express
  relative imports and the `no-frontend-to-server` cruiser rule keep holding. The "security/" top-level
  bucket in the brief is satisfied as this **boundary subtree** (`TARGET_REPO_STRUCTURE.md §6`).
- Shim each old path. Update `.github/CODEOWNERS` to map `server/security/**` (especially `authn/`,
  `policies/`, `tenancy/`) → `@exposwifty31`.
- **Risk:** high *visibility*, low *behavior* — pure relocation. The audit's A1–B4/C3 anchors move with
  the files. **Rollback:** revert batch; shims keep callers compiling.
- **Verify:** `auth-mode-resolution`, `require-clinical-authority`, `authority-*`, `dispense-auth-hardening`,
  `auth-hardening`, `cross-tenant-denial`, `server/tests/security.test.ts` all green.

---

## 3. infrastructure/ (database · queues · storage · messaging · integrations)

```
# database — keep schema/pool/migrations physically in server tree; group logically
server/schema/**          ->  server/infrastructure/database/schema/**
server/db.ts              ->  server/infrastructure/database/db.ts          # update re-export in db.ts shim
server/migrate.ts         ->  server/infrastructure/database/migrate.ts
server/seed.ts            ->  server/infrastructure/database/seed.ts
migrations/**             ->  (UNCHANGED — runner path is config-coupled; leave in place)  [CODEOWNERS]
# queues
server/lib/{queue,redis,postgresql}.ts   ->  server/infrastructure/queues/*
# storage / messaging
server/lib/push.ts        ->  server/infrastructure/messaging/push.ts
server/routes/{storage,uploads}.ts       ->  server/infrastructure/storage/*.routes.ts   (or keep under http/ — see note)
# integrations
server/integrations/**    ->  server/infrastructure/integrations/**
```
> **Caution — `server/db.ts` is a hub** (`CLAUDE.md`: pool + schema re-exports imported widely). Move it
> last in this batch and leave a re-export shim at `server/db.ts` for the whole migration; repoint
> importers in a dedicated late batch. Do **not** move `migrations/` (startup + `drizzle.config.ts` +
> `pnpm db:migrate` resolve it by path).
- **Risk:** medium — `db.ts` fan-in. **Rollback:** revert; the `db.ts` shim is the safety valve.
- **Verify:** server boots (`pnpm dev`), migrations apply, DB integration tests (when run) green.

---

## 4. workers/ (carve the separate-process domain)

```
server/app/start-schedulers.ts        ->  server/workers/orchestration/start-schedulers.ts
server/jobs/**                         ->  server/workers/orchestration/jobs/**     (runtime, registry, enqueue, definitions, queue-factory)
server/queues/**                       ->  server/workers/orchestration/queues/**
server/workers/*.ts                    ->  server/workers/executors/*.ts            (13 workers)
server/lib/event-publisher.ts          ->  server/workers/outbox/event-publisher.ts   FROZEN (relocate only)
server/lib/outbox-*.ts                 ->  server/workers/outbox/*
server/lib/code-blue-reconciliation-scanner.ts -> server/workers/outbox/*
server/lib/{cleanup-scheduler,system-watchdog,worker-heartbeat,role-notification-scheduler}.ts -> server/workers/scheduling/*
server/integrations/jobs/**            ->  server/workers/scheduling/integration/**
server/lib/{idempotency,inventory-job-recovery,equipment-replay-idempotency}.ts -> server/workers/orchestration/idempotency/*  (shared contract)
```
- **Caution:** `server/app/start-schedulers.ts` is the single registration point referenced by the worker
  entry and `CLAUDE.md`. Update `pnpm worker` script target (or shim the old path) in the same batch.
- **Risk:** medium — interleaved with backend `lib`. **Rollback:** revert batch; shims cover cross-imports.
- **Verify:** `pnpm worker` starts; `charge-alert-worker-unit`, `outbox-error-classification`,
  `task-ownership-backfill-worker`, `container-dispense-idempotency`, `equipment-replay-idempotency` green.

---

## 5. backend/ http + services + domain (the remainder of server/)

```
server/index.ts            ->  server/app/index.ts        (Express bootstrap; OR keep at server/index.ts as apps/api entry)
server/app/routes.ts       ->  server/http/routes.ts      (route registration)
server/routes/**           ->  server/http/routes/**      (48 routers + routes/equipment handlers + routes/domains)
server/middleware/{validate,rate-limiters,idempotency,*-idempotency}.ts -> server/http/middleware/*
server/services/**         ->  server/services/**         (UNCHANGED path; already cohesive)
server/domain/**           ->  server/domain/**           (UNCHANGED path; already cohesive)
server/config/**           ->  server/config/**           (UNCHANGED)
server/lib/* (remaining business logic) -> server/lib/**  (UNCHANGED — backend-owned utilities)
server/routes/realtime.ts, display.ts  ->  server/realtime/*   FROZEN (relocate only)
server/lib/realtime*.ts                ->  server/realtime/*   FROZEN (relocate only)
```
- Keep `server/services`, `server/domain`, `server/lib` (post-carve) in place — they are already
  domain-cohesive and high fan-in; relocating them buys little and risks much. The audit's preserve-mandate
  applies most strongly here.
- **Risk:** low-medium (route registration churn). **Rollback:** revert; shims on moved routers.
- **Verify:** server boots; route smoke; `pnpm test` green.

---

## 6. client domains (native / desktop / offline)

```
# native
src/native/**                          ->  src/native/**            (UNCHANGED — already target shape)
src/shell/mobile/MobileShell.tsx       ->  (RETIRE in MIGRATION_SEQUENCE Phase 4 — not a move)
src/features/{today,equipment,alerts,scan,settings,shift-chat,containers,inventory}/** -> src/native/screens/**
src/infrastructure/platform/*Adapter.ts -> src/native/platform/*
# desktop
src/desktop/**                         ->  src/desktop/**           (UNCHANGED — already target shape)
src/pages/**                           ->  src/desktop/pages/**
src/components/**                      ->  src/desktop/components/**
src/app/routes.tsx                     ->  src/desktop/router/DesktopRouter.tsx   (extract mobile path → src/native/router/MobileRouter.tsx in Phase 5)
# offline
src/lib/offline-db.ts                  ->  src/offline/db/offline-db.ts
src/lib/sync-engine.ts                 ->  src/offline/sync-engine/sync-engine.ts
src/lib/offline-emergency-block.ts     ->  src/offline/emergency/offline-emergency-block.ts   FROZEN  [CODEOWNERS]
src/infrastructure/db/EquipmentCacheAdapter.ts -> src/offline/adapters/EquipmentCacheAdapter.ts
src/infrastructure/db/SyncQueueAdapter.ts      -> src/offline/adapters/SyncQueueAdapter.ts
public/sw.js                           ->  (UNCHANGED path — SW scope + build-tag injection are path-coupled)  FROZEN
```
- **Caution:** `src/lib/offline-emergency-block.ts` and `public/sw.js` are FROZEN and CODEOWNERS-protected.
  Update `.github/CODEOWNERS` if `offline-emergency-block.ts` path changes; keep `public/sw.js` in place.
- **Caution:** moving `src/features/*` screens changes many imports and intersects the dual-tree collapse
  (F-3) — do this **after** Phase 4 picks the canonical screen per page, so you don't relocate a file you're
  about to delete. Until then, shim.
- **Risk:** medium-high (client churn + frozen surfaces). **Verify in a real browser + WKWebView + PWA**,
  not just `tsc` (audit §7). `mobile-shell.test.tsx` updated in lockstep.

---

## 7. apps/ entry composition (optional thin layer)

```
src/main.tsx               ->  src/app-entry/main.tsx     (OR keep at src/main.tsx; Vite entry is config-coupled)
src/App.tsx                ->  src/app-entry/App.tsx
index.html                 ->  (UNCHANGED — Vite root entry)
server/index.ts            ->  (apps/api entry — see §5)
```
> `apps/` in the brief maps to **entry points**. Vite (`index.html` + `main.tsx`) and the server bootstrap
> are build-config-coupled; prefer leaving them at their resolved paths and treating `apps/` as a *logical*
> grouping unless you also update `vite.config.ts`/`package.json` scripts in the same batch. **Recommended:
> defer `apps/` physical moves** — they are the highest config-coupling for the lowest ownership gain.

---

## 8. tooling / tests / docs

```
scripts/**                 ->  tooling/scripts/**         (UPDATE package.json script paths in same batch)
.dependency-cruiser.cjs    ->  (UNCHANGED — extend rules per DEPENDENCY_RULES.md)
.github/**                 ->  (UNCHANGED)
tests/**                   ->  tests/**                   (UNCHANGED — vite.config.ts excludes are path-coupled)
server/tests/**            ->  tests/server/**            (optional; update vitest include if moved)
docs/**                    ->  docs/**                    (UNCHANGED)
*.md (rebase deliverables) ->  docs/architecture/rebase/* (optional; root is fine for discoverability)
```
> Tests and most config are **path-coupled to runners** (`vite.config.ts`, `playwright*.config.ts`,
> `vitest*.config.ts`). Moving them requires editing those configs in lockstep — higher risk than reward.
> **Recommended: leave `tests/`, `migrations/`, and runner configs in place.**

---

## 9. Move summary & sequencing guard

| Batch | Scope | History | Shim | Behavior change | Browser verify |
|---|---|---|---|---|---|
| 1 | shared/ kernel | ✅ git mv | ✅ | none | no |
| 2 | backend/security/ | ✅ | ✅ | none | no |
| 3 | infrastructure/ (db hub last) | ✅ | ✅ (db.ts persists) | none | server boot |
| 4 | workers/ | ✅ | ✅ | none | worker boot |
| 5 | backend http/ remainder | ✅ | ✅ | none | server boot |
| 6 | client native/desktop/offline | ✅ | ✅ | none (moves) / **yes (Phase-4 collapse)** | **yes** |
| 7 | apps/ entries | defer | — | none | n/a |
| 8 | tooling/tests/docs | partial | — | none | CI |

**Hard guard:** a batch is not done until `npx tsc --noEmit` is zero-error **with shims in place**. Shim
removal and importer-repointing is a *separate* late step, ordered in `MIGRATION_SEQUENCE.md`. No batch
moves a file it is about to delete (dual-tree collapse precedes screen relocation).
