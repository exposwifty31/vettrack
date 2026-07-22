# VetTrack Equipment Readiness Wedge — Full Master Execution Plan with Code References, PR Breakdown, and Modular Architecture

**Document type:** Controlling execution plan (review-first; not yet incorporated until human sign-off)  
**Repository inspected:** `cursor/equipment-focus-cleanup-0bf6` (clean working tree)  
**Inspection date:** 2026-06-01 (read-only)

---

## Canonical status

**Approved with blockers — cleanup patch pending incorporation.**

Until incorporated into the master execution plan, this governance patch is **advisory governance text** and is **not** the controlling execution plan.

- **Incorporation requires explicit human sign-off.**
- **This document does not self-authorize incorporation.**
- After explicit approval and incorporation, it becomes the **governing blocker appendix** for the Equipment Readiness Wedge execution plan.
- **No application code work may begin from the pre-incorporation plan.**

---

## Part A — Product scope and non-goals

### A.1 Core product question

**Can this exact equipment unit be safely used right now?**

The wedge answers:

1. Where is this equipment?
2. Can it be used right now?
3. Who has it?
4. Why is it blocked?
5. What action fixes it?
6. Are we buying, repairing, or retiring equipment based on evidence?

### A.2 Primary equipment categories

Infusion pumps, monitors, anesthesia machines, oxygen cages, ultrasound, warming devices, ventilators, crash carts / critical kits, shared mobile equipment.

### A.3 Identification methods

RFID passive detection, NFC, QR/barcode, manual fallback.

### A.4 Truth Card (target UX contract)

Must show: readiness status, current location, custody / checked-out-by, RFID last-seen, human confirmation evidence, conflicts, blocking reasons, citations/evidence, next recommended action, one primary action.

### A.5 Readiness statuses (wedge target type)

```ts
export type EquipmentReadinessStatus =
  | "ready"
  | "in_use"
  | "blocked"
  | "stale"
  | "overdue"
  | "unknown";
```

**Repo note:** `GET /api/equipment/:id/truth` today returns `deployability.readinessState` / `custodyState` / `usageState` from operational-state resolvers (`shared/equipment-truth.ts`), not yet the wedge enum above. PR7–PR8 map resolver output → wedge statuses.

### A.6 Non-goals

No expansion back into broad hospital OS: patient workflow, billing, broad ER queue, drug inventory, dispense, CPR/shock guidance, medication advice, clinical decisioning, general appointments (beyond equipment tasks alias), staff chat, shift handover (except equipment handoff), broad non-readiness analytics, **AI command execution**, **RFID-driven custody mutation**.

**Code Blue / emergency:** equipment/note only, **online-only**, not offline queued, no drugs/CPR/shock/patient workflow/clinical decisioning. Frozen Phase-9 realtime/PWA doctrine applies.

---

## Part B — Governance precedence and incorporation

### B.1 Governance precedence

If this plan conflicts with prior blocker/cleanup/review/draft text, **this incorporated plan controls** until superseded by a later explicitly approved governance patch. **Do not choose the less restrictive interpretation.**

Tie-break: preserve compatibility → prevent drift → smaller PR scope → avoid hidden state mutation → tenant isolation → explicit review before risky work.

### B.2 Incorporation conflict check

Reviewer must attach conflict table **or** state in an **approved location**:

```text
No conflicts found during incorporation sweep.
```

| Conflicting source A | Conflicting source B | Conflict summary | Chosen interpretation | Reason | Approving reviewer |
|----------------------|----------------------|------------------|-------------------------|--------|--------------------|

**Owner record (required):**

| Incorporation review area | Owner | Status | Notes |
|---------------------------|-------|--------|-------|
| conflict sweep / no-conflicts statement | owner required | pending / approved / rejected | |

### B.3 Conflict statement location

- incorporation notes
- review package
- governance conflict section
- master plan incorporation summary

Must include: owner, approval status, date/review ID. Chat-only statements insufficient unless copied into approved location.

### B.4 Precedence reconciliation completion

Reconciled only when (1) no-conflicts statement with owner approval, or (2) complete conflict table for every conflict. Blocked if check missing, table incomplete, interpretation/reviewer missing, unresolved conflict remains.

### B.5 Terminology / reference sweep

| Sweep area | Owner | Approval status | Notes |
|------------|-------|-----------------|-------|
| terminology/reference sweep | owner required | pending / approved / rejected | |

Every hit: `replaced` | `removed` | `retained with justification`. Sweep scope: master plan, blocker/cleanup appendices, PR templates, copied sections, Cursor review templates, **approval tables/templates**.

Stale targets include: `implementation-ready`, `safe to execute blindly`, `PR1.1 fallback`, old PR numbers, all commands in PR12, silent shell deferral, global clinic readiness config, same Router aliasing, scan-truth freeform writes, `maybe`, blank owner/status.

---

## Part C — Master modular architecture

| Module | Owns | Must not own |
|--------|------|----------------|
| **7.1 Frontend route & nav** | Aliases, route-family match, active nav, shells, canonical hrefs, additive i18n | Page business logic, API, display payload, Code Blue behavior |
| **7.2 API alias** | Semantic aliases, router factories, parity | Same Router instance twice, semantic/auth/tenant changes, redirects, side-effect changes |
| **7.3 Equipment truth** | Deterministic readiness, evidence priority, conflicts, citations | AI override of truth |
| **7.4 Command board** | Board snapshot contract, rows, alerts, ROI signals | Breaking legacy display snapshot |
| **7.5 Readiness rules** | Clinic-scoped config, thresholds | Global config for clinic semantics |
| **7.6 RFID evidence** | Passive ingest, raw body/HMAC, passive outbox allowlist | Custody mutation |
| **7.7 scan-truth** | Resolve tag, approved evidence insert, truth + suggested action | Checkout/return/custody/emergency/task mutations |
| **7.8 Command façade** | `performCheckout` / `performReturn`, idempotency at service boundary | Internal HTTP delegation, duplicate state machine |
| **7.9 Emergency equipment log** | Presentation aliases, online-only framing | Domain rename without audit |
| **7.10 Feature flags** | Non-wedge API flags, capabilities | Production default flips before audit |
| **7.11 AI copilot** | Validators, advisory HTTP (PR17) | Command execution, separate evidence priority |

**Dependency direction (allowed):** PR0 → PR1 → PR2 → PR3 → PR4 → PR5 → PR6 → PR7 → PR8–10 → PR11 → PR12 → PR13–18. PR16 before PR17. PR0 before all.

---

## Part D — Canonical route policy (frontend)

### D.1 Canonical paths (generated links)

- `/equipment-board`
- `/equipment-tasks`
- `/locations`
- `/critical-kit-check`
- `/emergency-equipment-log`

### D.2 Legacy aliases (keep working; **no redirect** on `/display`)

- `/display`
- `/appointments`
- `/rooms`
- `/crash-cart`
- `/code-blue`

### D.3 Canonical product labels

Equipment · Equipment Command Board · Equipment Tasks · Critical Kit Check · Locations · My Equipment

Additive i18n only; keep `layoutHebrew.*`, `t.layout.nav.*`, `appointmentsPage.*`, etc.

### D.4 Planned route infrastructure (PR1a — **does not exist today**)

| Planned file | Intended shape | Inspect today | PR | Risk | Validation |
|--------------|----------------|---------------|-----|------|------------|
| `src/lib/routes/route-alias-groups.ts` | `ROUTE_ALIAS_GROUPS` const | **Missing** — create | PR1a | Route-family drift | Unit tests per matrix row |
| `src/lib/routes/matches-route-family.ts` | `matchesRouteFamily(pathname, routes)` | **Missing** | PR1a | Naive `startsWith` | Tests: `/locations/123`, `/locations/123/` |
| `src/lib/routes/route-family-ids.ts` | `ROUTE_FAMILY_MATCH_ORDER`, `resolveRouteFamilyId` | **Missing** | PR1a | Wrong active tab | Internal `//123` → `null` |
| `src/lib/routes/normalize-pathname.ts` | `normalizePathname` + `stripTrailingSlashes` | **Missing** | PR1a | Alias split on `/display/` | Full test matrix §D.6 |
| `src/lib/routes/canonical-hrefs.ts` (optional) | `CANONICAL_HREFS.*` | **Missing** | PR1a | Legacy href generation | Grep + inventory |

### D.5 `normalizePathname` test matrix (mandatory)

| Input | Expected |
|-------|----------|
| `""` | `/` |
| `"display"` | `/display` |
| `"/display/"` | `/display` |
| `"/display//"` | `/display` |
| `"/locations/123/"` | `/locations/123` |
| `"/locations//123"` | `/locations//123` (internal slashes preserved) |
| `"/display?mode=wall"` | `/display` |
| `"/display#kiosk"` | `/display` |
| `"https://example.com/display?mode=wall#kiosk"` | `/display` |
| `"//example.com/display"` | `/display` |
| `"?mode=wall"` | `/` |
| `"#kiosk"` | `/` |

### D.6 `resolveRouteFamilyId` (mandatory)

```ts
resolveRouteFamilyId("/locations/123") === "locations";
resolveRouteFamilyId("/locations/123/") === "locations";
resolveRouteFamilyId("/locations//123") === null;
resolveRouteFamilyId("/display//settings") === null;
```

### D.7 `ROUTE_ALIAS_GROUPS` (planned)

```ts
export const ROUTE_ALIAS_GROUPS = {
  equipmentBoard: ["/equipment-board", "/display"],
  equipmentTasks: ["/equipment-tasks", "/appointments"],
  locations: ["/locations", "/rooms"],
  criticalKitCheck: ["/critical-kit-check", "/crash-cart"],
  emergencyEquipmentLog: ["/emergency-equipment-log", "/code-blue"],
} as const;
```

### D.8 `matchesRouteFamily` (required helper)

```ts
export function matchesRouteFamily(
  pathname: string,
  routes: readonly string[],
): boolean {
  return routes.some((route) => {
    if (pathname === route) return true;
    return pathname.startsWith(`${route}/`);
  });
}
```

Fallback active matching:

```ts
return matchesRouteFamily(location, [href]);
```

Not:

```ts
return location === href || location.startsWith(`${href}/`);
```

### D.9 `ROUTE_FAMILY_MATCH_ORDER` (planned)

```ts
export const ROUTE_FAMILY_MATCH_ORDER = [
  "emergencyEquipmentWall",
  "emergencyEquipmentHistory",
  "emergencyEquipmentLog",
  "equipmentBoard",
  "equipmentTasks",
  "criticalKitCheck",
  "locations",
] as const;
```

**Repo finding:** `/code-blue/display` exists (`CodeBlueDisplay`); **not** `/code-blue-display`. PR14 must follow PR0 inventory for wall/history aliases.

### D.10 `normalizePathname` reference implementation

```ts
function stripTrailingSlashes(pathname: string): string {
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function normalizePathname(input: string): string {
  let pathname: string;
  try {
    pathname = new URL(input, "http://local").pathname || "/";
  } catch {
    const withoutHash = input.split("#", 1)[0] ?? "";
    const withoutQuery = withoutHash.split("?", 1)[0] ?? "";
    const normalized = withoutQuery || "/";
    pathname = normalized.startsWith("/") ? normalized : `/${normalized}`;
  }
  return stripTrailingSlashes(pathname);
}
```

---

## Part E — Canonical API policy

| Concept | Value |
|---------|--------|
| Mount (canonical board) | `/api/equipment-board` |
| Endpoint | `GET /api/equipment-board/snapshot` |
| Compatibility | `GET /api/display/snapshot` |

**Today:** only `app.use("/api/display", displayRoutes)` in `server/app/routes.ts`; `server/routes/display.ts` exports **singleton** `router` with `GET /snapshot`.

**Required PR2 pattern:**

```ts
export function createDisplayRouter(deps: DisplayRouterDeps) {
  const router = Router();
  router.get("/snapshot", createDisplaySnapshotHandler(deps));
  return router;
}
app.use("/api/display", createDisplayRouter(deps));
app.use("/api/equipment-board", createDisplayRouter(deps));
```

**Forbidden:** mounting same `displayRoutes` instance twice.

---

## Part F — Canonical PR sequence

| PR | Title |
|----|--------|
| PR0 | Baseline route/API/schema inventory |
| PR1 | Frontend canonical aliases, nav, active-state, route-family helpers, i18n keys |
| PR2 | API alias router factories and endpoint parity |
| PR3 | Equipment Command Board contract + additive display snapshot field |
| PR4 | Clinic-scoped readiness rules |
| PR5 | RFID gap analysis + evidence contracts |
| PR6 | RFID ingest and raw-body-safe mount helper |
| PR7 | Truth resolver RFID evidence integration |
| PR8 | Equipment Board critical rows and status derivation |
| PR9 | Equipment Board alerts |
| PR10 | Equipment Board ROI/utilization signals |
| PR11 | scan-truth endpoint and DB mutation contract |
| PR12 | Command façade MVP for checkout/return only |
| PR13 | One-hand/glove scan UX |
| PR14 | Emergency Equipment Log presentation aliases |
| PR15 | Non-wedge API feature flags and capabilities surface |
| PR16 | AI safety foundation, validator, threat model, red-team tests |
| PR17 | AI Copilot routes behind `ENABLE_ASSET_COPILOT` |
| PR18 | Docs, smoke tests, release hardening |

---

## Part G — PR0 baseline inventory

### G.1 Frontend routes (from `src/app/routes.tsx`)

| Current route | Component | Planned canonical / alias | Phase | Repo reference | Notes |
|---------------|-----------|---------------------------|-------|----------------|-------|
| `/display` | `WardDisplayPage` | alias of `/equipment-board` | PR1 | `routes.tsx:95` | Hard alias, no Redirect |
| `/equipment-board` | — | **new** → same as `/display` | PR1 | — | Add route |
| `/appointments` | `AppointmentsPage` | alias of `/equipment-tasks` | PR1 | `routes.tsx:114` | |
| `/equipment-tasks` | — | **new** | PR1 | — | |
| `/rooms` | `RoomsListPage` | alias of `/locations` | PR1 | `routes.tsx:90` | |
| `/rooms/:id` | `RoomRadarPage` | `/locations/:id` | PR1 | `routes.tsx:91` | Detail route exists |
| `/crash-cart` | `CrashCartCheckPage` | alias of `/critical-kit-check` | PR1 | `routes.tsx:97` | |
| `/code-blue` | `CodeBluePage` | alias of `/emergency-equipment-log` | PR1 | `routes.tsx:94` | Secondary nav only |
| `/code-blue/display` | `CodeBlueDisplay` | `/emergency-equipment-wall` per PR14 | PR14 | `routes.tsx:96` | Separate from ward `/display` |
| `/admin/code-blue-history` | `CodeBlueHistoryPage` | `/emergency-equipment-history` | PR14 | `routes.tsx:98` | Admin menu |
| `/equipment` | `EquipmentPage` | keep | — | `routes.tsx:80` | Primary nav anchor |
| `/my-equipment` | `MyEquipmentPage` | keep | — | `routes.tsx:89` | |
| `/alerts` | `AlertsPage` | keep direct access | — | `routes.tsx:88` | Not primary wedge nav |

### G.2 Navigation inventory (shared shells)

| Surface | File | Current href / behavior | Decision | Planned | Phase |
|---------|------|-------------------------|----------|---------|-------|
| Primary sidebar | `layout.tsx` | `/code-blue`, `/crash-cart` in primary list | PR1b update + reorder | Canonical hrefs + labels | PR1 |
| Active state | `layout.tsx:113` | `location === href` exact | Fix | `matchesRouteFamily` | PR1 |
| Operation menu whitelist | `layout.tsx:485` | legacy paths | Update | Canonical paths | PR1 |
| Bottom nav Rooms | `layout.tsx:1244` | `href="/rooms"` | **PR1** | `href="/locations"` | PR1 |
| Bottom nav active | `layout.tsx:510` | `startsWith("/rooms")` | Fix | `locations` family | PR1 |
| Topbar | `Topbar.tsx:17-18` | `/appointments`, `/display` | Update | canonical paths | PR1 |
| IconSidebar | `IconSidebar.tsx:35` | `startsWith(item.href)` | Fix per item | route-family | PR1 |
| PageShell | `PageShell.tsx` | wraps Topbar | Indirect | Topbar canonical | PR1 |
| Home CTAs | `home.tsx:421,440` | `/appointments` | Review | inventory row | PR1 |
| Room radar back | `room-radar.tsx:545,569` | `/rooms` | Review | `/locations` if in scope | PR1 |

### G.3 API mounts

| Mount | Router | Planned alias | Phase |
|-------|--------|---------------|-------|
| `/api/display` | `displayRoutes` singleton | keep | — |
| `/api/equipment-board` | — | `createDisplayRouter(deps)` | PR2 |
| `/api/equipment` | `equipmentRoutes` | `/:id/truth` | PR7+ |
| `/api/rfid` | raw body in `index.ts:222-225` | extend PR6 | PR5-6 |
| Copilot routes | none | PR17 | PR17 |

### G.4 Schema / services

| Asset | Purpose | Reuse? | Gap | Phase |
|-------|---------|--------|-----|-------|
| `vt_equipment` + RFID | EPC, last seen | Yes | Passive contract | PR5-7 |
| `vt_equipment_rfid_reads` | Raw reads | Yes | Idempotency PR5 | PR5-6 |
| `vt_scan_logs` | Scan audit | Maybe | No identity_confirmed — PR11 contract | PR11 |
| Checkout/return | Custody | Inline route | Extract services | PR12 |
| `GET /:id/truth` | Truth API | Yes | Wedge enum mapping | PR7-8 |
| `vt_server_config` | Config | Partial | Global keys — clinic scope PR4 | PR4 |
| Display snapshot | Ward board | Yes | No `commandBoard` | PR3 |

### G.5 PR0 deliverable

- Output **in chat** by default; no repo doc unless explicitly approved (this file is explicit human request for `.md` output).
- Shell inventory row-per-source-hit
- Coverage table per grep command
- `startsWith` classification artifact

---

## Part H — PR1 Frontend canonical aliases, nav, active state, i18n

### H.1 Scope lock

**Allowed:** `src/app/routes.tsx`, `src/lib/routes/*`, `layout.tsx`, `Topbar.tsx`, `IconSidebar.tsx`, additive locales.

**Forbidden:** `server/`, `shared/`, `src/pages/`, API, schema, display payload, Code Blue behavior, RFID, AI, commands, route deletion, `/display` Redirect.

### H.2 PR1a / PR1b

- **PR1a:** aliases, route-family helpers, `normalizePathname`, match order, additive i18n.
- **PR1b:** layout nav, shared shells, bottom nav wedge links, operation menus, active state, canonical hrefs, grep classification.

**Must not merge** until both complete in **same PR** unless explicit approved split recorded.

### H.3 Primary nav order (planned)

1. Equipment → `/equipment`
2. Equipment Command Board → `/equipment-board`
3. Equipment Tasks → `/equipment-tasks`
4. Critical Kit Check → `/critical-kit-check`
5. Locations → `/locations`
6. My Equipment → `/my-equipment`

**Secondary/menu-only:** Emergency Equipment Log, Emergency Equipment Wall, Emergency Equipment History, Alerts, Reports/Admin.

### H.4 Planned route additions (`src/app/routes.tsx`)

```tsx
<Route path="/equipment-board"><AuthGuard><WardDisplayPage /></AuthGuard></Route>
<Route path="/equipment-tasks"><AuthGuard><AppointmentsPage /></AuthGuard></Route>
<Route path="/locations"><AuthGuard><RoomsListPage /></AuthGuard></Route>
<Route path="/locations/:id"><AuthGuard><RoomRadarPage /></AuthGuard></Route>
<Route path="/critical-kit-check"><AuthGuard><CrashCartCheckPage /></AuthGuard></Route>
<Route path="/emergency-equipment-log"><AuthGuard><CodeBluePage /></AuthGuard></Route>
```

### H.5 PR1 ownership gates

| Gate | Owner | Blocks |
|------|-------|--------|
| PR1 scope re-review | required | Implementation start |
| Shell inventory completeness | required | Implementation + merge |
| Classification owner | required | Merge |
| Reconciliation completion | required | Merge |

### H.6 Shell inventory grep commands

```bash
rg 'to="/display"|to="/appointments"|to="/rooms"|to="/crash-cart"|to="/code-blue"' src
rg 'navigate\("/(display|appointments|rooms|crash-cart|code-blue)' src
rg 'href="/display"|href="/appointments"|href="/rooms"|href="/crash-cart"|href="/code-blue"' src
rg '"/display"|"/appointments"|"/rooms"|"/crash-cart"|"/code-blue"' src
```

**Dedup key:** file path + matched expression + stable snippet (line number supporting only).

**Coverage status:** `complete` | `no hits` | `blocked` | `needs review` — do not proceed on `blocked` or `needs review`.

### H.7 Allowed classifications

- shared shell/nav — update in PR1
- bottom nav wedge link — update in PR1
- secondary/menu-only nav — update or preserve per policy
- generated link — migrate to canonical
- active-state logic — normalize via alias family map
- analytics/page attribution — normalize or follow-up
- already canonical / already compliant — evidence required; **no mixed compliance**
- unrelated utility — no change, explain
- page internals — out of scope; stop for review if wedge links
- test fixture — update if appropriate
- alias route definition — keep
- compatibility route — keep
- ambiguous — stop for review

### H.8 Reconciliation

| Allowed status | Blocked status |
|----------------|----------------|
| `complete` | `pending` |
| `approved no-change` (with evidence) | `unresolved` |
| `reclassified with approval` | `needs review` |

**Proof cardinality:** one proof may satisfy multiple rows only if each row references it explicitly. No implicit proof sharing.

**Evidence location for `approved no-change`:** reconciliation table, shell inventory row ref, review package, PR comment, out-of-scope record.

### H.9 Classification source of truth

One classification per row. Reclassification requires inventory row update **or** approved override table. Merge blocked if inventory and reconciliation conflict.

### H.10 startsWith validation

```bash
rg 'startsWith\(' src/components src/lib/routes
```

Classify every hit. Merge blocked if naive prefix matching in active-route logic outside centralized helper. Fixed hits need route-family or shell active-state test.

### H.11 PR1 validation

```bash
git status --short
rg "<Route path=" src/app/routes.tsx
rg 'equipment-board|equipment-tasks|critical-kit-check|emergency-equipment|locations' src/app/routes.tsx
rg 'to="/display"|to="/appointments"|to="/rooms"|to="/crash-cart"|to="/code-blue"' src
rg 'navigate\("/(display|appointments|rooms|crash-cart|code-blue)' src
rg 'href="/display"|href="/appointments"|href="/rooms"|href="/crash-cart"|href="/code-blue"' src
rg '"/display"|"/appointments"|"/rooms"|"/crash-cart"|"/code-blue"' src
rg 'startsWith\(' src/components src/lib/routes
npx tsc --noEmit
pnpm test
git diff --name-only | rg '^server/' && exit 1 || true
git diff --name-only | rg '^shared/' && exit 1 || true
git diff --name-only | rg '^src/pages/' && exit 1 || true
```

### H.12 PR1 manual smoke

- `/display` renders; URL stays `/display`; no Redirect from `/display`
- `/equipment-board` same surface as display
- All legacy/canonical pairs work
- Active nav correct for canonical and legacy paths
- Primary nav order per §H.3; Emergency Equipment Log not primary
- `/alerts` still works if present
- No `server/`, `shared/`, `src/pages/` diff

---

## Part I — PR2 API alias router factories and endpoint parity

### I.1 Planned files

| File | Change |
|------|--------|
| `server/routes/display.ts` | `createDisplayRouter`, `createDisplaySnapshotHandler` |
| `server/app/routes.ts` | Two factory mounts |
| `tests/api/display-alias-parity.test.ts` | **New** parity suite |

### I.2 Auth/tenant parity matrix

| Case | Expected parity |
|------|-----------------|
| unauthenticated | same status/error semantics |
| authenticated, correct clinic, permitted | same success semantics |
| same session, entity other clinic | same 404/403 per **legacy** |
| wrong clinic context | same 404/403 per legacy |
| missing permission | same forbidden |
| entity not found in clinic | same not-found |
| invalid input | same validation |

**Do not correct** legacy 404 vs 403 in PR2.

### I.3 Error parity

Use stable discriminator when exposed (`code`, `reason` from `display.ts` `apiError`). No invented discriminator. Incidental headers (`date`, `server`, trace IDs) not blockers unless consumer-visible.

### I.4 Success parity

Same success status, content-type, materially relevant headers, redirect behavior, deterministic payload subset (strip volatile fields). **No add/remove/change** writes, audit, outbox, cache invalidation, session/auth/tenant side effects, domain events.

---

## Part J — PR3 Equipment Command Board + additive snapshot

### J.1 Planned files

| File | Purpose |
|------|---------|
| `shared/equipment-board.ts` | `EquipmentCommandBoardSnapshot` types |
| `server/services/equipment-command-board.service.ts` | `buildCommandBoardSnapshot` |
| `server/routes/display.ts` | Handler timeout wrapper |
| `tests/display-command-board-timeout.test.ts` | throw, timeout, metrics failure |

### J.2 Contract

```ts
commandBoard: EquipmentCommandBoardSnapshot | null; // always present; never undefined
```

### J.3 Failure isolation

```ts
const COMMAND_BOARD_TIMEOUT_MS = 2500; // explicit, review-visible

let commandBoard: EquipmentCommandBoardSnapshot | null = null;
try {
  commandBoard = await withTimeout(
    buildCommandBoardSnapshot({ clinicId }),
    COMMAND_BOARD_TIMEOUT_MS,
  );
} catch (error) {
  safeLogWarn({ error, clinicId }, "command_board_build_failed");
}
return { ...legacySnapshot, commandBoard };
```

**Acceptance:** Builder failure never breaks legacy snapshot response; observability best-effort.

---

## Part K — PR4 Clinic-scoped readiness rules

**Blocked** until clinic-scoped storage approved (`server/lib/server-config.ts` is global today).

| File | Purpose |
|------|---------|
| `shared/equipment-readiness-rules.ts` | `equipment.readinessRules.v1` schema |
| `server/services/equipment-readiness-rules.service.ts` | `getReadinessRules(clinicId)` |
| Migration | **DO NOT APPLY UNTIL APPROVED** |

Cache keys must include `clinicId`. No global fallback changing clinic semantics.

---

## Part L — PR5 / PR6 RFID evidence layer

### L.1 PR5 gap analysis (no new tables until approved)

Prove against: `server/schema/equipment.ts`, `server/routes/rfid.ts`, `server/index.ts` raw mount.

### L.2 PR6 mount helper

```ts
export function mountRfidRoutes(app: Express, path: string, deps: RfidDeps) {
  app.use(path, express.raw({ type: "application/json" }), createRfidRouter(deps));
}
```

### L.3 RFID outbox allowlist

**Allowed:** `equipment.evidence_observed`, `equipment.passive_location_observed`, `equipment.rfid_presence_changed`, `equipment.truth_may_have_changed`, `equipment.board_may_have_changed`

**Forbidden:** custody/checkout/return/emergency/task/ready/unavailable mutations

---

## Part M — PR7 Truth resolver RFID integration

- Passive evidence only; no custody mutation
- Distinguish `passiveObservedLocation` vs `humanConfirmedLocation`
- Status priority: blocked > overdue > stale > in_use > ready > unknown
- Expose conflict metadata for PR16

**Inspect:** `server/routes/equipment/handlers/get-equipment-truth.ts`, `server/domain/equipment/evidence/resolver/*`

---

## Part N — PR8 / PR9 / PR10 Board rows, alerts, ROI

| PR | Deliverable |
|----|-------------|
| PR8 | `criticalUnits`, `overview`, `byType`, `byLocation` |
| PR9 | Alert taxonomy; max one primary alert per unit |
| PR10 | ROI signals; utilization formula |

```ts
const utilizationScore =
  scanEvents30d * 1 + checkoutEvents30d * 3 + emergencyUseEvents30d * 5;
```

Avoid guaranteed savings / actual ROI wording without cost data.

---

## Part O — PR11 scan-truth + DB mutation contract

**Design-blocked** until mapping table concrete and owners approved.

| Required field | Status |
|----------------|--------|
| target table | concrete required |
| allowed columns | concrete required |
| allowed status/type values | concrete required |
| outbox behavior | concrete required |
| truth-ranking behavior | concrete required |
| clinicId filter | concrete required |
| forbidden side effects | concrete required |

**May:** resolve tag; insert approved evidence; return truth + suggested action.

**Must not:** checkout, return, custody, emergency, task complete, ready/unavailable, custody/emergency outbox.

**Do not** invent freeform `vt_scan_logs.status` without approved evidence-event contract.

---

## Part P — PR12 Command façade (checkout/return only)

```ts
export async function performCheckout(input: CheckoutCommandInput): Promise<CheckoutDomainResult> {
  // authorization, validation, transaction, custody, evidence, audit, outbox
}
```

**Routes (planned):**

- `POST /api/equipment/:id/commands/checkout`
- `POST /api/equipment/:id/commands/return`

**Forbidden:** `fetch("/api/equipment/:id/checkout")`, internal HTTP, Express handlers as pseudo-services, duplicate state machine.

**Idempotency:** shared service boundary or approved adapter above it.

**Future commands (not PR12):** confirm-location, mark-issue, complete-inspection, mark-repaired, post-emergency-reset.

---

## Part Q — PR13 One-hand / glove scan UX

| File | Purpose |
|------|---------|
| `/scan` route | Scan screen |
| Global Scan FAB | Quick access |
| Glove mode | 48px / 64px / 72px targets |
| `use-scan-truth` hook | PR11 client |

RFID suggests; human acts.

---

## Part R — PR14 Emergency Equipment Log presentation aliases

| Canonical | Compatibility (repo) |
|----------|----------------------|
| `/emergency-equipment-log` | `/code-blue` |
| `/emergency-equipment-wall` | `/code-blue/display` |
| `/emergency-equipment-history` | `/admin/code-blue-history` |

Presentation only until audit. Online-only; no offline queue.

---

## Part S — PR15 Feature flags + capabilities

Flags (audit-first): `ENABLE_CLINICAL_API`, `ENABLE_DISPENSE_API`, `ENABLE_SHIFT_CHAT_API`, `ENABLE_BROAD_INVENTORY`, `ENABLE_BROAD_PROCUREMENT`

Preferred: `GET /api/platform/capabilities`

---

## Part T — PR16 AI safety foundation

**Default:** `ENABLE_ASSET_COPILOT=false`

**Exists:** `citation-validator.ts` (validity only), `shared/contracts/asset-copilot.v1.js`, resolver under `server/domain/equipment/evidence/`

**PR16 adds:** claim-support, freshness, type, contradiction vs resolver priority; read-only metadata contract; red-team tests.

**Minimum resolver metadata:** readiness status, freshness, source type, confidence, conflict state/type, priority outcome, passive vs intentional, location/custody confirmation, citation IDs.

**PR16 approval table:**

| Approval area | Primary owner | Objections recorded? | Objection disposition | Status |
|---------------|---------------|----------------------|-------------------------|--------|
| truth/evidence resolver metadata | required | yes/no | none/pending/… | pending |
| AI validator sufficiency | required | yes/no | | pending |
| read-only contract and tenant isolation | required | yes/no | | pending |

Written objections only. Unresolved written objections block progress.

---

## Part U — PR17 AI Copilot HTTP (after PR16)

- `POST /api/equipment/:id/copilot/explain`
- `POST /api/equipment-board/copilot/brief`
- `POST /api/equipment-copilot/query`
- `POST /api/equipment-copilot/feedback`

Flag-gated; advisory only; no command execution.

---

## Part V — PR18 Docs, smoke, release hardening

Route/API smoke, tenant isolation regression, no offline emergency mutation regression, release notes, rollback notes, alias sunset plan (audit-only).

---

## Part W — Tenant isolation (every backend PR)

- `eq(table.clinicId, clinicId)` on target table
- No trust of client `clinicId`
- Cache keys include `clinicId`
- Cross-clinic tests for tag, name, room, reader, session cross-entity access

---

## Part X — Binding-when-touched

Binding when actual diff touches area. Reviewer of record is arbiter.

| Area | When touched |
|------|----------------|
| startsWith / active route | route-family or shell test |
| PR3 timeout | abort preferred; else handler timeout; `commandBoard: null` |
| PR12 idempotency | service boundary |
| Label shortening | PR + i18n notes + tests |

Dispute table required when disputed; merge blocked while `pending`.

---

## Part Y — PR merge gates summary

| PR | Must not merge if |
|----|-------------------|
| PR1 | Aliases incomplete; `/display` redirects; shell/reconciliation/owners incomplete; partial PR1a/PR1b without approval |
| PR2 | Same Router twice; parity incomplete |
| PR3 | `commandBoard` undefined; builder breaks legacy; no timeout |
| PR4 | Global clinic readiness config |
| PR5 | RFID migration before gap approval |
| PR6 | RFID outbox implies custody mutation |
| PR7 | RFID mutates custody |
| PR11 | TBD mapping or pending owners |
| PR12 | Duplicate logic; internal HTTP |
| PR16 | Metadata/validators incomplete |
| PR17 | Before PR16 approved |

---

## Part Z — PR template

```markdown
## PR{N} — {title}

### Scope
- In scope:
- Out of scope:

### Governance owners
| Area | Owner | Status |

### Planned files
| File | Change |

### Validation
```bash
# commands
```

### Acceptance criteria
- [ ] ...

### Rollback
- ...
```

---

## Part AA — Rollback and deployment

| PR range | Rollback |
|----------|----------|
| PR1 | Revert nav/routes; legacy paths remain |
| PR2 | Remove equipment-board mount |
| PR3 | Clients ignore `commandBoard` |
| PR16–17 | `ENABLE_ASSET_COPILOT=false` |

Deploy: PR1 → PR2 → PR3 before UI depends on `commandBoard`.

---

## Part AB — Review references

| Planned change | Plan ref | Repo evidence | Risk gate |
|----------------|----------|---------------|-----------|
| `/equipment-board` alias | PR1 | `routes.tsx:95` `/display` | PR1 smoke |
| Route-family active nav | PR1 | `layout.tsx:113` | tests |
| `/api/equipment-board` | PR2 | `routes.ts:82` singleton | factory |
| `commandBoard` field | PR3 | `display.ts` response | timeout |
| `performCheckout` | PR12 | `equipment.ts:497+` | no internal HTTP |
| Copilot HTTP | PR17 | no copilot routes | PR16 |

---

## Part AC — startsWith classification seed

| File | Line | Classification | Action |
|------|------|----------------|--------|
| `layout.tsx` | 266, 291 | unrelated utility | document |
| `layout.tsx` | 509-510 | legacy active-route | fix |
| `Topbar.tsx` | 36 | legacy active-route | fix |
| `IconSidebar.tsx` | 35 | legacy active-route | fix per item |

---

## Final implementation hold

Approved with blockers — cleanup patch pending incorporation. Do not begin implementation until the full master execution plan is output in chat with planned code references, PR breakdown, modular architecture, governance blockers, validation gates, and acceptance criteria; this plan is reviewed and explicitly approved by a human; prior governance patches are reconciled under the precedence rule; PR1 scope is reviewed again; PR1a + PR1b are confirmed to complete in the same PR unless an explicit approved split is recorded; and PR1 shell inventory plus reconciliation have no pending classification, proof, approval, coverage, or conflict rows.

---

## Incorporation next steps (human)

1. Record `No conflicts found during incorporation sweep.` or conflict table in incorporation notes.
2. Complete terminology sweep with owner **approved**.
3. Sign off this document as controlling appendix.
4. Run PR0 full inventory (expand grep to row-per-source-hit table).
5. Assign PR1 owners; begin PR1 only after PR1 scope re-review **approved**.
