# Flow-walk harness — Phase-10 III.6 four-platform live walk

Executable form of `docs/audit/FLOW_INVENTORY.md`. It walks every inventory flow
across **marketing · web · board · iPhone · iPad**, under each role archetype, and
records a pass/broken/degraded/observe/unreachable matrix — the III.6 evidence the
program-plan.md resubmission gate (Phase 10) requires.

> **Status:** the harness is stood up and self-verifying, but the *walk itself has not
> been run* (no booted sim / running app when authored). Running it is the Phase-10
> gate step — see "When to run" below.

## Files

| File | Role |
|---|---|
| `flow-inventory.manifest.ts` | **Source of truth.** All 31 inventory rows + the drift block, reconciled against `src/app/routes.tsx`. Per-row: paths, guard, platforms, role gating, expected outcomes. |
| `flow-inventory.manifest.test.ts` | Vitest self-check — structural invariants, inventory coverage, and a **drift guard** that fails if a route's guard classification diverges from `routes.tsx`. Runs in `pnpm test`. |
| `walk-helpers.ts` | Playwright helpers: dev-role injection, surface detection, outcome classification, matrix writer. |
| `web-board-walk.spec.ts` | The web + board + marketing walk (Playwright). `PW_SUITE=flow-walk`. |
| `native/` | Isolated Appium/WDIO harness for the iPhone + iPad rows. |

## The model that makes this correct

Two platform-level facts drive every expected outcome — get these wrong and the whole
matrix is wrong:

1. **The desktop web app is a management console (T-31 / R-WEB-01).** `AuthGuard` shows
   `ManagementWebGate` to any role WITHOUT `management.web` (admin + lead only), on
   *every* desktop route — it preempts `WebOnlyGuard` / `ManagementGuard` / `CustodyGuard`.
   So on web, a non-management role gets the gate everywhere; only `/board` (board target),
   `/signin` etc. (marketing target), and pure `<Redirect>` routes escape it.
2. **Native is the mobile target, so that gate is inert.** On iPhone/iPad the real
   per-route guards fire: `WebOnlyGuard` → `/home`, `CustodyGuard` student → `/equipment`.

These live in `expectedWebOutcome` / `expectedNativeOutcome` and are unit-tested.

## Drift from the 2026-07-06 inventory (encoded, tagged `drift: true`)

`routes.tsx` moved on since the doc. The manifest reflects current truth:
- `/equipment/scan`, `/equipment/maintenance`, `/equipment/intelligence` → redirects.
- `/shift-handover`, `/pending`, `/pending-emergencies` → redirect to `/equipment`.
- `/equipment/board`, `/display`, `/equipment-board` → redirect to the canonical `/board`.
- `/stability`, `/app-tour`, `/admin/medication-integrity` → redirects.
- **New:** the `WebOnlyGuard > ManagementGuard` web console (`/admin/integrations`,
  `/webhooks`, `/notifications`, `/rfid-readers`, `/governance`, `/audit-log`,
  `/inventory`, `/people`, `/displays`, `/ops/health`) — absent from the inventory doc.

The `flow-inventory.manifest.test.ts` drift guard keeps these in sync going forward.

## When to run

Both original gates are met: docking P3 merged to main (#106, 2026-07-15), so results
stamp against current routes. The remaining prerequisite is **a running walk server** —
web needs `pnpm dev:walk`; native needs a booted sim with the dev-bypass shell installed.

## Run — web + board + marketing

```bash
pnpm dev:walk                   # terminal 1: walk server (:3001 API, :5000 web)
pnpm test:playwright:flow-walk  # terminal 2 (walks the Vite port, :5000)
```
- `dev:walk` = `dev:bypass` + `PLAYWRIGHT_E2E=true`, which skips the global per-IP API
  rate limiter (the same switch CI's Playwright API server uses). Without it a 5-role
  walk trips the 100 req/min limit and every row after the cliff bounces to `/signin`.
- Self-skips with a clear message if the app isn't reachable — safe to invoke anytime.
- Writes `artifacts/flow-walk/web-matrix.json` + per-row screenshots under
  `artifacts/flow-walk/screenshots/`.
- Cycles all five role archetypes. management.web roles (admin, senior_technician) walk
  every row; gated roles (vet, technician, student) walk the ungated rows + one sample per
  gated guard family to confirm `ManagementWebGate` fires (the matrix notes the sampling).

## Run — native (iPhone + iPad)

See `native/README.md`. Summary:
```bash
cd tests/flow-walk/native && pnpm install
pnpm walk:iphone      # or pnpm walk:ipad
```

## Reading the matrix

Each result carries `expected` vs `actual` outcome + `status`:
- **pass** — matched the firm expectation.
- **broken** — firm mismatch (e.g. a removed-scope route rendered a real page → blocking).
- **degraded** — rendered, but with console errors.
- **observe** — mismatch on a non-pinned expectation (recorded, not a failure).
- **unreachable** — navigation threw.

Stamp the corresponding `⏳ pending` rows in `docs/audit/FLOW_INVENTORY.md` from the matrix
and reconcile `docs/audit/PROOF_ALIGNMENT_LOG.md`, per III.4/III.6.
