# CURRENT_OWNERSHIP_MAP.md

> **Phase 1 — Discover actual repository ownership.**
> Every path in the repo classified into a **category** (Domain · Infrastructure · Runtime · Security ·
> Shared · Tooling · Tests · Documentation) and assigned an **owner** = one of the six canonical domains
> from `ARCHITECTURE_MAP.md` (`shared` · `native` · `desktop` · `offline` · `backend` · `workers`).
> Counts are from `git ls-files` on branch `claude/repo-architectural-rebase-wnv8nc`.
> This is the *as-is* ownership. The *to-be* layout is `TARGET_REPO_STRUCTURE.md`.

**Legend** — `owner` is the target domain that *should* own the path. `status`:
`✅ already in place` · `↔ needs relocation` · `⊕ split across locations` · `⚠️ duplicate/legacy to retire`.

---

## 1. Summary by owner

| Owner domain | Primary current locations | Approx files | Status |
|---|---|---|---|
| **shared** | `src/core/`, `src/lib/routes/`, top-level `shared/`, `src/types/`, `lib/i18n`, `shared/contracts/` | ~40 | ⊕ split across 5 roots |
| **native** | `src/native/`, `src/shell/mobile/`, `src/features/{today,equipment,alerts,scan,...}` (touch screens) | ~50 | ⚠️ NativeShell + legacy MobileShell coexist |
| **desktop** | `src/desktop/`, `src/pages/`, `src/components/`, `src/shell/desktop/` | ~90 | ↔ `AppShell`/`Layout` to collapse |
| **offline** | `src/lib/offline-db.ts`, `sync-engine.ts`, `offline-emergency-block.ts`, `public/sw.js`, realtime client | ~15 | ↔ scattered in `src/lib` |
| **backend** | `server/` (routes, services, domain, schema, middleware, integrations, most of `lib`) | ~270 | ↔ flat `server/` → `backend/` tree |
| **workers** | `server/workers/`, `server/jobs/`, `server/queues/`, `server/app/start-schedulers.ts`, outbox libs | ~35 | ↔ interleaved with `backend/lib` |
| **(tooling/tests/docs)** | `scripts/`, `tests/`, `server/tests/`, `docs/`, root configs, root `*.md` | ~600 | mostly stable; relocate per category |

---

## 2. Frontend (`src/**`) — client domains

### 2.1 shared (kernel) — `⊕ split`
```
src/core/entities/*            owner: shared    (design-tokens, index)
src/core/ports/index.ts        owner: shared    (platform contract interfaces)
src/core/use-cases/*           owner: shared    (offline-emergency-block, index)
src/core/index.ts              owner: shared
src/lib/routes/**              owner: shared    (nav-model = THE route table)   [SSoT]
src/types/**                   owner: shared    (API contract types, 11 files)
src/shared/index.ts            owner: shared
```
Plus the top-level `shared/` and `lib/i18n` (see §5). **Action:** consolidate all into one `shared/`.

### 2.2 native (touch presentation) — `⚠️ duplicate owners live`
```
src/native/NativeShell.tsx        owner: native   ✅ new sole-owner shell (target)
src/native/NativeScreen.tsx       owner: native   ✅ scroll/safe-area/keyboard owner (target)
src/native/NativeTabBar.tsx       owner: native   ✅
src/native/{ScanFab,NativeShellContext,index}  owner: native ✅
src/shell/mobile/MobileShell.tsx  owner: native   ⚠️ LEGACY — competing shell, retire (Phase 3/4)
src/shell/mobile/{MobileTabBar,MobilePageHeader,ScanFab,MobileShellContext,index}  owner: native ⚠️ legacy
src/features/today/**             owner: native   (TodayScreen + hooks)
src/features/equipment/**         owner: native   (EquipmentListScreen, EquipmentDetailScreen, …)
src/features/alerts/**            owner: native   (AlertsScreen)
src/features/scan/**              owner: native   (ScanScreen, TransferSheet, AccountabilityConfirm)
src/features/settings/**          owner: native   (MoreSheet, SettingRow)
src/features/shift-chat/**        owner: native   (ShiftChatPanel + components)
src/features/containers/**        owner: native   (DispenseSheet)
src/features/inventory/**         owner: native   (restock-session-reducer)
src/features/auth/**              owner: native    ⚠️ AuthGuard/useAutoSelectOrg — auth-adjacent; lives client-side, integrates via shared AuthSessionPort
```

### 2.3 desktop (web/pointer presentation) — `↔ relocate + collapse`
```
src/desktop/WebShell.tsx       owner: desktop   ✅ new sole desktop shell (target)
src/desktop/index.ts           owner: desktop   ✅
src/pages/**                   owner: desktop   (43 route-level page components)
src/components/**              owner: desktop   (37 entries; shadcn primitives in components/ui/)
src/shell/desktop/index.ts     owner: desktop
src/app/routes.tsx             owner: desktop   ↔ becomes DesktopRouter; mobile path → MobileRouter
src/App.tsx, src/main.tsx      owner: desktop   (runtime entry — see Runtime §6)
src/index.css                  owner: desktop   ⚠️ holds global body/.app-shell insets to delete (Phase 3)
```
> **Legacy shells to retire (`⚠️`):** `AppShell` 3-way dispatcher + `Layout` (1548 LOC). Per audit Q3:
> `AppShell` → desktop-only `WebShell`; `Layout` retired once mobile-web routes through `NativeShell`.
> (These currently live inside `src/components`/`src/pages` shell code referenced by the audit.)

### 2.4 offline (sync / PWA) — `↔ scattered in src/lib`
```
src/lib/offline-db.ts                 owner: offline   (Dexie: equipment/rooms cache, pending queue)
src/lib/sync-engine.ts                owner: offline   (FIFO queue, retry, circuit-breaker, conflict store)
src/lib/offline-emergency-block.ts    owner: offline   FROZEN (Code Blue never queued)   [CODEOWNERS-protected]
src/infrastructure/db/EquipmentCacheAdapter.ts   owner: offline ✅ (CachePort impl)
src/infrastructure/db/SyncQueueAdapter.ts        owner: offline ✅ (SyncQueuePort impl)
src/lib/* (realtime client reconciliation, sw registration helpers)  owner: offline  ↔
public/sw.js                          owner: offline   FROZEN (build-tag cache, emergency denylist)
```

### 2.5 infrastructure (client platform adapters) — `✅ mostly placed`
```
src/infrastructure/platform/NfcAdapter.ts        owner: native    (NfcPort impl, Capacitor)
src/infrastructure/platform/HapticsAdapter.ts    owner: native    (HapticsPort impl)
src/infrastructure/platform/DeepLinkAdapter.ts   owner: native    (DeepLinkPort impl)
src/infrastructure/api/index.ts                  owner: shared/native (ApiClientPort wiring)
src/infrastructure/auth/index.ts                 owner: native    (AuthSessionPort impl — Clerk web)
src/shared/platform/PlatformRouter.tsx           owner: shared/native ✅ the single platform switch (Phase 2)
```

### 2.6 client runtime/state libs — `↔`
```
src/lib/api.ts                 owner: shared/offline   (API client + authStore module store)
src/hooks/**                   owner: native/desktop   (21 hooks: auth, push, settings, offline sync)
src/lib/i18n.ts (+generated)   owner: shared           (typed t accessor; types from scripts/i18n)
```

---

## 3. Backend (`server/**`) — server domains

### 3.1 backend (Express API) — `↔ flat → backend/ tree`
```
server/index.ts                owner: backend   (Express entry; Runtime §6)
server/instrument.ts           owner: backend   (Sentry instrument)
server/app/routes.ts           owner: backend   (registers ~48 route modules)
server/routes/**               owner: backend   (48 resource routers + server/routes/equipment/ handlers)
server/services/**             owner: backend   (23 domain services)
server/domain/**               owner: backend   (equipment evidence/copilot domain logic)
server/middleware/{validate,rate-limiters,idempotency,*-idempotency}.ts  owner: backend
server/config/inventoryBlueprint.ts   owner: backend
server/lib/* (non-worker, non-security, non-realtime business logic)  owner: backend
   e.g. alert-engine, analytics-engine, billing/forecast, dispense-*, equipment-*, push, apiError, …
```

### 3.2 SECURITY (authn/authz/policies/audit) — `↔ stays inside backend/, highlighted boundary`
```
server/middleware/auth.ts                       category: Security/authn   [CODEOWNERS-protected]  [A1-A4]
server/middleware/authority.ts                  category: Security/authz   [B1-B4]
server/middleware/tenant-context.ts             category: Security/tenancy [C3]
server/middleware/ensure-user-clinic-membership.ts  category: Security/tenancy
server/lib/authority.ts                          category: Security/authz   (resolveAuthority, the ONE resolver) [B1]
server/lib/authority-*.ts                        category: Security/authz   (cache, roles, audit)
server/lib/authority/**                          category: Security/policies (enforcement envelope off|shadow|enforce) [B4]
server/lib/role-resolution.ts                    category: Security/authz   [B1]
server/lib/clerk-session-auth.ts, clerk-*.ts     category: Security/authn   [A1]
server/lib/auth-mode.ts                          category: Security/authn   [A2]
server/lib/admin-email-allowlist.ts              category: Security/authn   [A4]
server/lib/stability-token.ts, stability-log.ts  category: Security/authn   [A3]
server/lib/apple-auth.ts                          category: Security/authn
server/lib/audit.ts                              category: Security/audit   (closed AuditActionType union)
server/lib/config-crypto.ts                      category: Security         (AES-256-GCM credential encryption)
server/lib/access-denied.ts, er-mode-permissions.ts, task-rbac.ts  category: Security/authz
```
> The brief's generic template puts `security/` at top level. In VetTrack security is a **cross-cutting
> boundary physically realized inside `backend/`** (middleware + `lib/authority/*` + auth libs). The
> target keeps it there and makes the boundary explicit (subtree + CODEOWNERS + lint), rather than
> tearing auth out of the request pipeline. See `TARGET_REPO_STRUCTURE.md §security`.

### 3.3 Database / persistence (Infrastructure) — `↔`
```
server/db.ts                   owner: backend   (Drizzle pool + schema re-exports)
server/schema/**               owner: backend   (9 files: core/equipment/inventory/tasks/ops/er/integrations/helpers/index)
server/migrate.ts              owner: backend   (runMigrations())
server/seed.ts                 owner: backend
migrations/**                  owner: backend   (163 SQL files)  [CODEOWNERS-protected]
```

### 3.4 Integrations (Infrastructure) — `↔`
```
server/integrations/**         owner: backend   (adapters, webhooks, conflicts, dashboard, rollout, resilience — 60+ files)
server/routes/{webhooks,integrations,whatsapp}.ts  owner: backend
server/lib/{push,redis,queue,postgresql}.ts        owner: backend/infrastructure
```

### 3.5 Realtime (FROZEN — Infrastructure/messaging) — `↔`
```
server/routes/realtime.ts            owner: backend   FROZEN (SSE stream/replay/telemetry endpoints)
server/routes/display.ts             owner: backend   FROZEN (snapshot — emergency denylist)
server/lib/realtime*.ts              owner: backend   FROZEN (realtime, realtime-outbox, version)
server/lib/event-publisher.ts        owner: workers   FROZEN (outbox publisher; see §4)
```

---

## 4. Workers (`server/workers`, `server/jobs`, `server/queues`) — `↔`
```
server/app/start-schedulers.ts       owner: workers   (single registration point)
server/workers/**                    owner: workers   (13 workers: chargeAlert, expiryCheck, integration, sweeps, …)
server/jobs/**                       owner: workers   (runtime, registry, enqueue, definitions, queue-factory)
server/queues/**                     owner: workers   (charge-alert, integration, inventory-deduction, sweep queues)
server/lib/event-publisher.ts        owner: workers   FROZEN (FOR UPDATE SKIP LOCKED)
server/lib/outbox-*.ts               owner: workers   (janitor, dlq-scanner, error-classification, health)
server/lib/code-blue-reconciliation-scanner.ts   owner: workers
server/lib/{cleanup-scheduler,system-watchdog,worker-heartbeat,role-notification-scheduler}.ts  owner: workers
server/lib/{idempotency,inventory-job-recovery,equipment-replay-idempotency}.ts  owner: workers/backend (shared idempotency contract)
server/integrations/jobs/**          owner: workers   (integration retention/schedules)
```
> Workers code is currently **interleaved** with `backend/lib`. The split is by responsibility, not by
> folder today — `REPO_MOVE_PLAN.md` carves it out.

---

## 5. Shared kernel split (cross-cutting) — `⊕`
```
shared/*.ts (top level)        owner: shared   (authority, code-blue-authority, permissions, equipment-truth,
                                                 equipment-readiness-rules, equipment-board, equipment-waitlist,
                                                 handoff-debt, constants, er-types, realtime-schema-version,
                                                 doctor-operational-shift, emergency-surfaces.manifest)
shared/contracts/**            owner: shared   (asset-copilot.v1, cursor-bug-fixer.v1)
lib/i18n/**                    owner: shared   (index, loader, middleware, types, internal-keys)
```
These are imported by **both** `src/` and `server/` today — confirming they are the kernel. Target: fold
into `shared/{entities,contracts,i18n}` and enforce the framework-agnostic lint (already partially in
`.dependency-cruiser.cjs` rule `shared-is-framework-agnostic`).

---

## 6. Runtime / entry points (category: Runtime)
```
src/main.tsx                   owner: desktop   (IonApp → Providers → PlatformRouter; SW registration — FROZEN)
src/App.tsx                    owner: desktop   (useIsMobile fork → shells)
server/index.ts                owner: backend   (Express bootstrap; env-bootstrap FIRST)
server/app/start-schedulers.ts owner: workers   (worker process entry via pnpm worker)
capacitor.config.ts            owner: native    (webDir: dist/public; native bridge config)
index.html                     owner: desktop   (viewport-fit=cover; PWA meta)
vite.config.ts                 owner: tooling   (build → dist/public; test excludes)
```

---

## 7. Tooling (category: Tooling)
```
scripts/**                     (auth-preflight, run-migrations, validate-prod, i18n/*, ci/*, ops/*, architecture/*, native build, screenshots, secrets scan)
.dependency-cruiser.cjs        ✅ boundary enforcement (extend per DEPENDENCY_RULES.md)
.github/CODEOWNERS             ✅ ownership enforcement (extend to six domains)
.github/workflows/**           (ci, playwright, release-gate, nightly sims, flake-detection)
knip.json, components.json, drizzle.config.ts, postcss.config.cjs, tailwind.config.ts
tsconfig*.json (5), playwright*.config.ts (4), vitest*.config.ts (2)
Dockerfile, railway.json, nixpacks.toml, deploy.sh, setup-vm.sh, node-version
package.json, pnpm-lock.yaml
```

---

## 8. Tests (category: Tests)
```
tests/**                       (392 files; vitest + Playwright. Excluded groups: DB integration, live-server, Phase-9 drills)
server/tests/**                (security.test.ts, shift-chat.test.ts, validate.ts)
tests/phase-9-deterministic-drills.test.ts · tests/phase-9-drills.spec.ts   (frozen-surface drills)
tests/cross-tenant-denial.test.ts          [C4 regression lock — keep green]
tests/mobile-shell.test.tsx                (shell-aware — update in lockstep, R-5)
```

---

## 9. Documentation (category: Documentation)
```
docs/**                        (architecture/, decisions/, adr/, audit/, integrations/, mobile/, offline-*, governance/, …)
docs/architecture/adr/ADR-001-capacitor-ionic.md   (the ADR the rebase amends — F-2)
Root *.md                      (README, CLAUDE, AGENTS, PLAN, STRUCTURE_PLAN, SECURITY, CONTRIBUTING, BUG_REGISTER, …)
ARCHITECTURE_MAP.md · CURRENT_OWNERSHIP_MAP.md · TARGET_REPO_STRUCTURE.md
REPO_MOVE_PLAN.md · DEPENDENCY_RULES.md · MIGRATION_SEQUENCE.md   ← this rebase's deliverables
```

---

## 10. Ownership conflicts found (the reason the rebase exists)

| # | Conflict | Files | Resolution (target) |
|---|---|---|---|
| O-1 | **Two mobile shells** | `src/native/NativeShell.tsx` vs `src/shell/mobile/MobileShell.tsx` | Retire `MobileShell`; `NativeShell` sole owner (Phase 3/4) |
| O-2 | **Kernel split 5 ways** | `src/core`, `src/lib/routes`, top `shared/`, `src/types`, `lib/i18n` | Consolidate into one `shared/` (Phase 1) |
| O-3 | **Security tangled in `server/lib`** | auth/authority/clerk/stability libs mixed with business `lib` | Carve explicit `backend/.../security` subtree + CODEOWNERS |
| O-4 | **Workers interleaved with backend lib** | outbox/scheduler/idempotency libs in `server/lib` | Carve `workers/` domain (separate-process boundary) |
| O-5 | **Two switches decide one thing** | `App.tsx` (platform) + `AppShell` (viewport) | `PlatformRouter`/`resolvePlatformTarget()` sole switch (Phase 2) |
| O-6 | **Global insets vs shell insets** | `src/index.css` body/.app-shell + 7 per-screen owners | `NativeScreen`/`Container` sole inset owners (Phase 3) |
| O-7 | **Unused dependency** | `zustand` (0 imports) | Remove or formally adopt (Phase 6, F-2) |
