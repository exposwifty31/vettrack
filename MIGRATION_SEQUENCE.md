# MIGRATION_SEQUENCE.md

> **Phase 5 — Migration order.**
> The smallest, safest sequence to move the repo from its current (mid-convergence) state to
> `TARGET_REPO_STRUCTURE.md`, **preserving behavior, git history, and every audit guarantee.**
> Canonical order (brief): shared → security → infrastructure → domains → workers → applications →
> tests → tooling. Mapped here onto the audit's `MIGRATION_PLAN.md` phases, because that plan is what this
> repo is being made *ready to execute*.
>
> **Golden rule (audit §4.1, R-9):** retire-as-you-go — every step deletes a competing owner or is a pure
> shimmed move; **no step adds a third owner**. Each step is independently shippable and reversible.

---

## 0. Pre-flight gate (do once, blocks everything)

- **Files moved:** none. **Adds:** CODEOWNERS for six domains; `dependency-cruiser` R1/R3/R5 as `warn`;
  the `clinicId` co-presence AST lint R8 as `warn`; the concern-ownership lint R7 as `warn`.
- **Risk:** none (no runtime change).
- **Rollback:** revert the guardrail commit.
- **Verify:** `npx tsc --noEmit` green; CI runs the new lints in non-blocking mode; existing suites green.

---

## Step 1 — shared/ kernel  *(brief: shared)*

- **Files moved:** `REPO_MOVE_PLAN.md §1` — `src/core/*`, `src/lib/routes/*`, top-level `shared/*.ts`,
  `src/types/*`, `shared/contracts/*`, `lib/i18n/*` → `domains/shared/**` (each shimmed). Add `@shared/*`
  tsconfig path.
- **Risks:** import churn only; i18n parity / no-hebrew-in-source could trip if a locale file path changes.
- **Rollback:** revert batch commit (shims make it atomic).
- **Verify:** `npx tsc --noEmit`; `pnpm test` → `i18n-parity`, `i18n-no-hebrew-in-source`, kernel unit
  tests green. Flip R1 (`shared-no-frameworks`) `warn → error`.

---

## Step 2 — backend/security/  *(brief: security)*

- **Files moved:** `REPO_MOVE_PLAN.md §2` — auth/authority/clerk/stability/audit/tenant libs + the two
  auth middlewares → `server/security/{authn,authz,policies,audit,tenancy}/**` (each shimmed). Update
  CODEOWNERS to protect `server/security/**`.
- **Risks:** highest *visibility* (touches the auth core) but pure relocation — A1–B4/C3 anchors travel
  with the files; no logic edit. Mis-shim could break a guarded route.
- **Rollback:** revert batch; shims keep callers compiling.
- **Verify:** `auth-mode-resolution`, `require-clinical-authority`, `authority-roles`, `auth-hardening`,
  `dispense-auth-hardening`, `authority-enforcement-*`, `authority-*-rollback-invariant`,
  `cross-tenant-denial`, `server/tests/security.test.ts` **all green**. Flip R4 to `error`.

---

## Step 3 — infrastructure/  *(brief: infrastructure)*

- **Files moved:** `REPO_MOVE_PLAN.md §3` — schema/db/migrate/seed → `server/infrastructure/database/`;
  queue/redis/postgresql → `queues/`; push → `messaging/`; `server/integrations/**` → `integrations/`.
  **`server/db.ts` keeps a permanent shim** (hub); **`migrations/` stays in place** (runner path-coupled).
- **Risks:** medium — `db.ts` fan-in; a broken DB re-export halts boot. Migration runner path must not move.
- **Rollback:** revert batch; the `db.ts` shim is the safety valve.
- **Verify:** `pnpm dev` boots; `pnpm db:migrate` applies; DB-integration + `restock.service` (when run)
  green; webhook tests (`verify-signature`) green. Flip R6 to `error`.

---

## Step 4 — domains: backend http remainder + client domains  *(brief: domains)*

Two independently-shippable sub-steps.

### 4a — backend http/realtime relocation (server-side, low risk)
- **Files moved:** `REPO_MOVE_PLAN.md §5` — `server/app/routes.ts` + `server/routes/**` →
  `server/http/`; `validate`/`rate-limiters`/idempotency middleware → `http/middleware/`;
  realtime endpoints → `server/realtime/` (FROZEN, relocate only). `services/`, `domain/`, `lib/`
  (post-carve) **stay in place** (cohesive, high fan-in, preserve-mandate).
- **Risks:** route-registration churn. **Rollback:** revert; shims on moved routers.
- **Verify:** server boots; route smoke; full `pnpm test` green; realtime drills unaffected.

### 4b — client domains (native / desktop / offline) — **highest blast radius**
- **Files moved:** `REPO_MOVE_PLAN.md §6` — offline libs → `src/offline/**`; platform adapters →
  `src/native/platform/**`; pages/components → `src/desktop/**`. **`public/sw.js` stays** (FROZEN, path-coupled).
- **Retires (the convergence work, audit Phases 3–5 — behavior change, review each):**
  - Phase 3: `NativeScreen` becomes sole scroll/safe-area/keyboard owner; **delete** `body`/`.app-shell`
    global insets (`src/index.css`) + ~20 per-screen `env(safe-area-*)` + `MobileShell` top-pad dup.
  - Phase 4: **retire `Layout` (1548 LOC)**; rename `AppShell → WebShell`, delete its `insideMobileShell`
    pass-through + `Layout` branch; **collapse the 5 dual-tree pages** (pick canonical, delete the other).
  - Phase 5: add `MobileRouter` (native stack) over the shared route table; decommission the global
    `wouter <Switch>` subtree-swap for native (desktop/marketing keep wouter outlets).
  - Then relocate `src/features/*` screens → `src/native/screens/**` (only **after** the collapse, so no
    file is relocated then deleted).
- **Risks:** 🔴 scroll-root change (documented sticky-header regression, `index.css:379-383`); 🔴 frozen
  surfaces (SW/SSE/build-tag/emergency denylist must stay byte-for-byte); 🟠 dual-tree deletion drops a
  feature if wrong canonical chosen.
- **Rollback:** per-shell / per-page (each is its own commit). Feature-flag the `PlatformRouter` cutover.
- **Verify:** **real browser + WKWebView + installed PWA** (not just `tsc`); `mobile-shell.test.tsx`
  updated in lockstep; `phase-9-drills.spec.ts` green; emergency-block + cache-denylist assertions pass.
  Flip R3 / R7 to `error`.

---

## Step 5 — workers/  *(brief: workers)*

- **Files moved:** `REPO_MOVE_PLAN.md §4` — `start-schedulers.ts`, `jobs/`, `queues/`, `workers/*`,
  outbox/scheduler/idempotency libs → `server/workers/{orchestration,executors,scheduling,outbox}/**`
  (event-publisher FROZEN, relocate only). Update `pnpm worker` target.
- **Risks:** medium — interleaved with backend `lib`; the outbox publisher is FROZEN.
- **Rollback:** revert batch; shims cover cross-imports.
- **Verify:** `pnpm worker` starts; `charge-alert-worker-unit`, `outbox-error-classification`,
  `task-ownership-backfill-worker`, idempotency tests green. Flip R5 to `error`.
- **Hardening (audit Phase 6, can land here or separately):** pilot-queue DLQ + alarm (E3/I3);
  64-bit `hashtextextended` advisory locks (I4); reconsider `charge-alert attempts:1`.

> **Ordering note:** workers is listed after domains in the brief, but Step 5 has **no dependency** on 4b
> and can ship right after Step 3 (server-side only). Sequence by risk appetite; it does not block client work.

---

## Step 6 — applications  *(brief: applications)*

- **Files moved:** `REPO_MOVE_PLAN.md §7` — entry composition. **Recommended: defer / minimize** — Vite
  (`index.html` + `main.tsx`) and the server bootstrap are build-config-coupled; treat `apps/` as a
  logical grouping unless `vite.config.ts` + `package.json` scripts are edited in the same batch.
- **Risks:** high config-coupling for low ownership gain.
- **Rollback:** revert; configs reverted in lockstep.
- **Verify:** `pnpm build` produces `dist/public`; `pnpm dev` + `pnpm start` + `pnpm worker` all boot;
  SW registration intact (FROZEN).

---

## Step 7 — tenancy RLS backstop + state hygiene  *(audit Phase 6 — the security backstops)*

- **Files moved:** none (additive). **Adds:** per-request `set_config('app.current_clinic_id', …, true)`
  in the tenant transaction + `CREATE POLICY` on every `vt_` table (new migration); D3 explicit
  `eq(table.clinicId, clinicId)` predicates; remove (or formally adopt) `zustand`.
- **Risks:** 🟠 RLS over-blocks **workers run without a user** — grant system/cross-clinic contexts an
  explicit `app.current_clinic_id`/bypass role **before** flipping any policy to enforce (R-T).
- **Rollback:** RLS rolls out `shadow → enforce` like the authority envelope; revert the enforce migration.
- **Verify:** shadow logs show zero false denials for all tenants + worker contexts before enforce;
  `cross-tenant-denial` + structural lock green; flip R8 (`clinicId` co-presence) `warn → error`.

---

## Step 8 — tests & tooling  *(brief: tests, tooling)*

- **Files moved:** `REPO_MOVE_PLAN.md §8` — `scripts/` → `tooling/scripts/` (update `package.json` paths).
  **Recommended: leave `tests/`, `migrations/`, and all runner configs in place** (path-coupled to
  `vite.config.ts`/`playwright*.config.ts`/`vitest*.config.ts`). Optionally move rebase deliverable docs
  → `docs/architecture/rebase/`.
- **Risks:** low — script path drift. **Rollback:** revert; configs reverted in lockstep.
- **Verify:** CI green end-to-end (`ci.yml`, `playwright.yml`, `release-gate.yml`); `auth:preflight`,
  `validate:prod`, i18n scripts resolve.

---

## Step 9 — shim cleanup (final)

- **Files moved:** none. Repoint every importer from old shimmed path → new path; **delete all compat
  shims**; remove tsconfig `paths` for retired roots; remove all lint allowlist entries.
- **Risks:** wide but mechanical (codemod find-and-replace per shim).
- **Rollback:** shims can be re-added per path if an importer was missed.
- **Verify:** `npx tsc --noEmit` zero-error with **no shims present**; full `pnpm test` + CI green; the
  six-domain graph in `DEPENDENCY_RULES.md §1` fully `error`-enforced; `grep` finds no remaining
  `export * from` shim stubs.

---

## Sequence summary

| Step | Brief bucket | Audit phase | Files | Behavior change | Blast radius | Browser verify |
|---|---|---|---|---|---|---|
| 0 | — | 0 | 0 (guardrails) | none | none | no |
| 1 | shared | 1 | ~40 (shimmed) | none | low | no |
| 2 | security | 1 | ~35 (shimmed) | none | high-visibility / low-behavior | no |
| 3 | infrastructure | — | ~80 (db.ts shim persists) | none | medium | server boot |
| 4a | domains (server) | — | ~60 (shimmed) | none | low-medium | server boot |
| 4b | domains (client) | 2–5 | ~140 + retirements | **yes** | 🔴 high | **yes** |
| 5 | workers | 6 | ~35 (shimmed) | none (+hardening) | medium | worker boot |
| 6 | applications | — | few (defer) | none | high config-coupling | build/boot |
| 7 | (tenancy backstop) | 6 | 0 moved / additive | additive (RLS) | medium (R-T) | shadow→enforce |
| 8 | tests, tooling | 0 | ~scripts | none | low | CI |
| 9 | (cleanup) | all | 0 moved | none | mechanical | full CI |

**Stop points:** the repo is shippable after **every** step. Per the audit, a team may legitimately stop
after Step 7 (converged + hardened + Expo-ready) without paying for the Expo/RN rewrite (audit Phase 7 is
trigger-gated, not scheduled). This sequence makes the repo *ready to begin executing* `MIGRATION_PLAN.md`.
