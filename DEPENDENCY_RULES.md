# DEPENDENCY_RULES.md

> **Phase 4 — Dependency enforcement.**
> The architectural import rules that make the target structure self-policing. These **extend the
> existing** `.dependency-cruiser.cjs` (which already encodes the client/server split and the
> `shared-is-framework-agnostic` rule). Source of truth for the graph: `TARGET_ARCHITECTURE.md §7`.
> Every rule below maps to a `dependency-cruiser` `forbidden` entry; the lint runs in CI and fails the build.

---

## 1. The graph (allowed imports only)

```
shared/    → ∅                       (imports NOTHING but TypeScript + other shared/)
backend/   → shared/                 (+ its own infrastructure substrate)
workers/   → shared/, backend/
offline/   → shared/
native/    → shared/, offline/
desktop/   → shared/, offline/
apps/api   → backend/, infrastructure/, shared/
apps/worker→ workers/, backend/, infrastructure/, shared/
apps/client→ native/, desktop/, offline/, shared/
```
**Invariants:** acyclic · `shared/` is the universal sink · no domain imports a presentation domain ·
**no shell imports another shell** · the only client↔server code is `shared/`.

---

## 2. Rules (the `Define:` list)

### R1 — `shared/` imports nothing framework-bound
```
shared/*   cannot import   react · react-dom · @ionic/* · @capacitor/* · express ·
                           drizzle-orm · wouter · dexie · native/ · desktop/ ·
                           offline/ · backend/ · workers/
```
> This single rule **is** the Expo strategy. Already partially present as
> `shared-is-framework-agnostic` (`from ^shared/ → to ^(server|src)/`). Extend the `to` set with the
> framework package globs above.

### R2 — domains cannot import presentation
```
shared/    cannot import   native/ · desktop/ · offline/ · backend/ · workers/
backend/   cannot import   native/ · desktop/ · offline/ · workers/ · src/*  (client)
workers/   cannot import   native/ · desktop/ · offline/ · UI of any kind
offline/   cannot import   native/ · desktop/ · backend/ · workers/
```
> `backend/ cannot import src/*` and `src/* cannot import server/*` already exist as
> `no-server-to-frontend` / `no-frontend-to-server` (severity `error`). Keep them.

### R3 — no shell imports another shell
```
native/    cannot import   desktop/
desktop/   cannot import   native/
(neither imports the legacy AppShell/Layout/MobileShell once retired)
```
> Kills the `AppShell → MobileShell` cross-talk and the dual-tree forks (F-3/F-4).

### R4 — security boundary is import-only from the pipeline
```
backend/security/*   cannot import   apps/* (entry composition) · any client domain
backend/security/*   may import      shared/ (auth types) · backend infrastructure/database (DB reads)
non-security backend cannot import   security internals EXCEPT the published middleware
                                     (auth.middleware, authority.middleware) and audit.logAudit
```
> Security is consumed via its middleware/exports, never reached around. Role is **never** read from JWT;
> `clinicId` is **never** trusted from the client (enforced behaviorally + by `cross-tenant-denial` lock).

### R5 — workers depend down, never on UI
```
workers/   may import      shared/ · backend/ (schema, services)
workers/   cannot import   native/ · desktop/ · offline/ · any React/DOM
```
> Workers are a separate process; the outbox publisher and schedulers must not pull client code.

### R6 — infrastructure is a leaf substrate
```
infrastructure/*   may import      shared/
infrastructure/*   cannot import   native/ · desktop/ · offline/ · backend/http (no upward calls)
backend/ + workers/ may import     infrastructure/*
```

### R7 — screens/pages are consumers, never owners (concern-ownership lint)
```
native/screens/*   cannot use   env(safe-area-inset-*) · 100dvh · matchMedia ·
                                document/viewport scroll roots · draw a tab bar
desktop/pages/*    cannot use   the above mobile chrome primitives
```
> Cross-cutting chrome is applied once, at the shell edge (`NativeScreen` / `WebShell.Container`).
> Implemented as a regex/AST lint over `screens/`+`pages/` (audit ownership matrix; P1 contract).

### R8 — `clinicId` co-presence (tenant isolation backstop, audit I1)
```
any SELECT/UPDATE/DELETE filtering a vt_ table by `id`
   MUST also filter by `clinicId` in the same statement
```
> AST rule (the audit's named close for I1). Initially `warn` with an allowlist for the
> grandfathered D3 sites (`procurement.ts` UPDATEs, `containerItems` lookup/insert), flipped to `error`
> after the Phase-6 D3 fix. Complements the structural assertion already in `cross-tenant-denial.test.ts`.

### R9 — preserve existing grandfathered rules
Keep, unchanged, from `.dependency-cruiser.cjs`:
- `no-route-db-in-new-code` — `server/routes/domains/*` cannot import `db` (legacy `server/routes/*.ts` grandfathered).
- `asset-copilot-no-mutation-imports` — evidence/resolver/orchestrator cannot reach equipment write routes.
- `no-features-to-pages-internals` (warn) — features don't import arbitrary page modules.
- `no-circular` (warn → tighten to error per-domain once moves settle).

---

## 3. Frozen-surface guards (lint + CI assertions)

These are not import rules but CI gates that must accompany the boundary lint (audit §6, `CLAUDE.md`):

| Guard | Assertion |
|---|---|
| Emergency cache denylist | `/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/*` never added to any Cache Storage path |
| Offline-emergency-block | Code Blue mutations classified `never-queue`; not reachable from sync-engine enqueue |
| SSE transport | no WebSocket/polling import introduced on the realtime path |
| Build-tag | `__VT_BUILD_TAG__` is the only SW cache-name source |
| Enforcement envelope | every `server/security/policies/*` evaluator exports `off|shadow|enforce`; Strategy-A fallback present |
| Telemetry cardinality | every realtime telemetry field is a bounded enum on both client and `realtime.ts` |

---

## 4. dependency-cruiser additions (sketch)

Append to `.dependency-cruiser.cjs` `forbidden[]` (paths use the migrated tree; adjust during moves):

```js
// R1 — kernel is framework-free (extends shared-is-framework-agnostic)
{ name: "shared-no-frameworks", severity: "error",
  from: { path: "^(domains/shared|shared)/" },
  to:   { path: "react|react-dom|@ionic/|@capacitor/|express|drizzle-orm|wouter|dexie",
          dependencyTypesNot: ["type-only"] } },

// R3 — no shell imports another shell
{ name: "no-cross-shell", severity: "error",
  from: { path: "^src/native/" }, to: { path: "^src/desktop/" } },
{ name: "no-cross-shell-rev", severity: "error",
  from: { path: "^src/desktop/" }, to: { path: "^src/native/" } },

// R5 — workers never import client/DOM
{ name: "workers-no-client", severity: "error",
  from: { path: "^server/workers/" }, to: { path: "^src/|react|react-dom" } },

// R2 — offline isolated from shells/server
{ name: "offline-no-shells", severity: "error",
  from: { path: "^src/offline/" }, to: { path: "^src/(native|desktop)/|^server/" } },
```
> The `clinicId` co-presence (R8) and concern-ownership (R7) rules are **AST/eslint** rules (not graph
> rules) — wire them as separate CI steps, initially `warn`, per `MIGRATION_SEQUENCE.md` Phase 0.

---

## 5. Enforcement lifecycle

1. **Phase 0:** add R1/R3/R5/R8 as `warn` (allowlisted) + CODEOWNERS for the six domains.
2. **Per move batch:** flip the rule for the just-migrated domain from `warn` → `error`.
3. **Cleanup:** once shims are removed and importers repointed, no allowlist entries remain.
4. **Steady state:** the graph in §1 is fully `error`-enforced; a violating PR fails CI before review.
