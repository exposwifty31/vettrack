# Plan: Documentation and Scripts Renewal

## Summary

Align VetTrack’s human-facing documentation, npm scripts, and agent guidance with the **equipment-first** codebase after migrations **142** (ER/patients removed) and **143** (medication/formulary removed). Delete ~80–120 obsolete planning docs, fix broken script wiring, add a `docs:audit` generator, and rewrite canonical entry points so a developer or agent can onboard without stale ER/medication/pilot references.

## User Story

As a **VetTrack engineer or AI agent**,
I want **documentation and scripts that match the current codebase**,
So that **onboarding, ops runbooks, and automated gates do not reference removed features or broken commands**.

## Problem → Solution

**Current state:** README, CLAUDE.md, CONTEXT.md, and ~193 files under `docs/` still describe ER Mode, formulary sync, medication tasks, pilot gating, and 49+ superpowers planning artifacts. `pnpm sync:formulary` points to a missing file. Generated audits (`docs/audit/*`) are from 2026-06-09 with wrong copilot path (`/ask` vs `/explain`) and removed pages.

**Desired state:** Single doc index, scope-change doc, regenerated inventories, canonical docs describing equipment/waitlist/Code Blue/tasks/inventory/native shell, and a trimmed `scripts/` tree with working npm aliases.

## Metadata

- **Complexity**: XL
- **Source PRD**: [`/Users/dan/.cursor/plans/docs_scripts_renewal_c4d2878e.plan.md`](/Users/dan/.cursor/plans/docs_scripts_renewal_c4d2878e.plan.md)
- **PRD Phase**: standalone (full program)
- **Estimated Files**: ~100–130 touched (80–120 deletes, 15–20 creates/rewrites, 8–10 script edits)

---

## UX Design

### Before

```
┌─────────────────────────────────────────────┐
│  New contributor / agent reads README       │
│  → sees sync:formulary, vt_animals, ER      │
│  → runs broken script or searches er.ts     │
│  → docs/superpowers contradicts code        │
│  → pilot-mode.ts referenced but deleted     │
└─────────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────────┐
│  docs/README.md → scope-change-2026.md      │
│  → setup, mobile, CI, invariants            │
│  Canonical: README / CLAUDE / CONTEXT       │
│  pnpm docs:audit → fresh route/db inventories│
│  No dead npm scripts; deck:* wired          │
└─────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Doc entry | Scattered; superpowers archive | `docs/README.md` index | Single front door |
| Scope questions | ER/meds docs imply live features | `docs/scope-change-2026.md` | Redirect map from `routes.tsx` |
| Route inventory | Stale 2026-06-09 audit | `pnpm docs:audit` | Copilot path `/copilot/explain` |
| npm scripts | `sync:formulary` broken | Removed; `deck:*` added | Match investor-deck README |
| Agent skills | Point to `docs/superpowers/*` | Point to `docs/architecture/offline-realtime-invariants.md`, `docs/mobile/*` | clinical + bedside skills |

**Internal change — no end-user product UX change.**

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | [`migrations/142_drop_er_patients_shift_handover.sql`](migrations/142_drop_er_patients_shift_handover.sql) | all | What ER/patient surfaces were removed |
| P0 | [`migrations/143_drop_medication_pharmacy_forecast.sql`](migrations/143_drop_medication_pharmacy_forecast.sql) | all | What medication/formulary was removed |
| P0 | [`server/app/routes.ts`](server/app/routes.ts) | 1–135 | Live API mount registry (no pilot gating) |
| P0 | [`src/app/routes.tsx`](src/app/routes.tsx) | 1–175 | Canonical + legacy redirect map |
| P0 | [`server/app/start-schedulers.ts`](server/app/start-schedulers.ts) | all | Live schedulers/workers |
| P0 | [`server/jobs/runtime.ts`](server/jobs/runtime.ts) | 1–120 | BullMQ job runtime (charge-alert, expiry, stale-checkin) |
| P1 | [`server/schema/index.ts`](server/schema/index.ts) | all | Schema barrel layout |
| P1 | [`server/schema/helpers.ts`](server/schema/helpers.ts) | 1–6 | `vtTable` alias for audit generator |
| P1 | [`scripts/architecture/extract-express-routes.mjs`](scripts/architecture/extract-express-routes.mjs) | 429–529 | Contract format; pilot metadata to remove |
| P1 | [`server/middleware/rate-limiters.ts`](server/middleware/rate-limiters.ts) | 4–22 | Global limit **100/min** (not 120) |
| P1 | [`server/middleware/auth.ts`](server/middleware/auth.ts) | 41–50 | Full `ROLE_HIERARCHY` incl. aliases |
| P1 | [`server/workers/inventory-deduction.worker.ts`](server/workers/inventory-deduction.worker.ts) | all | No-op stub — do not document async billing path |
| P1 | [`server/lib/dispense-order-validation.ts`](server/lib/dispense-order-validation.ts) | 24–37 | Orphan enforcement **disabled** (returns empty) |
| P2 | [`docs/setup/environment.md`](docs/setup/environment.md) | all | Freshest env doc — keep, link from index |
| P2 | [`docs/mobile/native-mobile-implementation-manual.md`](docs/mobile/native-mobile-implementation-manual.md) | all | Replaces superpowers native spec |
| P2 | [`.gitlab-ci.yml`](.gitlab-ci.yml) | 122–141 | CI architecture job scope vs `pnpm architecture:gates` |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Drizzle schema split | Internal only | Tables in `server/schema/*.ts`; `server/db.ts` re-exports pool + schema |
| PRP workflow | Cursor `/prp-plan` command | This plan is the implementation artifact |

**No external research needed — feature uses established internal patterns.**

---

## Patterns to Mirror

### DOC_GENERATOR_SCRIPT
```javascript
// SOURCE: scripts/architecture/extract-express-routes.mjs:1-20, 482-527
#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
```

### ARCHITECTURE_GATE_RUNNER
```javascript
// SOURCE: scripts/architecture/run-architecture-gates.mjs:12-42
function run(label, command, args, options = {}) {
  console.log(`\n[architecture-gates] ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    console.error(`[architecture-gates] Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}
```

### SCHEMA_TABLE_DEFINITION
```typescript
// SOURCE: server/schema/equipment.ts:12-14, server/schema/helpers.ts:1-5
import { vtTable } from "./helpers.js";

export const folders = vtTable("vt_folders", {
  id: text("id").primaryKey(),
  clinicId: text("clinic_id").notNull().references(() => clinics.id, { onDelete: "restrict" }),
```

### RATE_LIMIT_CONSTANT
```typescript
// SOURCE: server/middleware/rate-limiters.ts:4-12
// Audit (2026-06-10): GLOBAL reduced from 6_000 to 100 (per-IP backstop).
export const GLOBAL_API_LIMITER_MAX_PER_MINUTE = 100;
```

### ROLE_HIERARCHY
```typescript
// SOURCE: server/middleware/auth.ts:41-50
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 40,
  vet: 30,
  senior_technician: 25,
  lead_technician: 22,
  vet_tech: 20,
  technician: 20,
  student: 10,
};
```

### AUDIT_MARKDOWN_HEADER
```markdown
# VetTrack — API Route Inventory

All routes registered in `server/app/routes.ts`. Generated YYYY-MM-DD.
```

### PACKAGE_JSON_SCRIPT_ENTRY
```json
"docs:audit": "node scripts/docs/generate-audit-inventories.mjs",
"deck:seed": "tsx scripts/seed-investor-deck-demo.ts"
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `scripts/docs/generate-audit-inventories.mjs` | CREATE | Orchestrates route/FE/DB markdown regeneration |
| `scripts/docs/extract-frontend-routes.mjs` | CREATE | Parses `src/app/routes.tsx` |
| `scripts/docs/extract-schema-inventory.mjs` | CREATE | Lists `vtTable("vt_*")` from schema files |
| `scripts/architecture/extract-express-routes.mjs` | UPDATE | Remove pilot metadata; optional `--write-md` |
| `package.json` | UPDATE | Remove `sync:formulary`; add `docs:audit`, `deck:*` |
| `README.md`, `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md`, `PRODUCT.md`, `.cursorrules` | REWRITE | Equipment-first canonical truth |
| `docs/README.md`, `docs/scope-change-2026.md`, `docs/mobile/README.md` | CREATE | Doc index + scope doc |
| `docs/migrations.md`, `docs/architecture/backend-routing.md`, `docs/CHATGPT_PROJECT_INSTRUCTIONS.md` | REWRITE | Fix stale counts and pilot refs |
| `docs/audit/routes.md`, `docs/audit/frontend-routes.md`, `docs/audit/db.md` | REGENERATE | Via `pnpm docs:audit` |
| `docs/superpowers/**`, `docs/pilot-mode/**`, ~40 stale standalone docs | DELETE | User chose delete-not-archive |
| `replit.md`, orphan scripts (see tasks) | DELETE | Misleading / broken |
| `.agents/skills/clinical-enterprise-integrity/*`, `bedside-ux-clinical-ui/*`, `publish-mobile-app/REJECTIONS.md` | UPDATE | Remove superpowers/ER refs |
| `.claude/PRPs/plans/native-mobile-desktop-strategy.plan.md` | DELETE | Superseded by `docs/mobile/native-mobile-implementation-manual.md` |
| `ARTIFACTS.md`, `IMPLEMENTATION_PLAN.md`, `BUG_REGISTER.md` | TRIM or DELETE | Remove stale milestone claims |
| `docs/investor-deck/README.md` | UPDATE | `pnpm deck:seed` now works via package.json |
| `.agents/skills/expo/FORK.md` | UPDATE | Point native design to `docs/mobile/` not superpowers |

## NOT Building

- Application code behavior changes (routes, services, schema)
- Rewriting all Playwright/vitest specs that mention removed pages (redirects suffice)
- Pruning `.claude/skills/ecc/**` third-party bundle
- Deleting ECC Python skill scripts (`.claude/skills/ecc/**/*.py`)
- Regenerating investor-deck PNG screenshots
- New champion training curriculum (optional single `docs/champion-guide.md` only if time permits in PR3)

---

## Step-by-Step Tasks

### Task 1: Fix `extract-express-routes.mjs` pilot drift

- **ACTION**: Remove dead pilot-mode contract fields and detection logic.
- **IMPLEMENT**:
  - Delete `pilotGated` from `RouteEntry` typedef and all assignments.
  - Remove `indexInPilotGuard`, `if (!isPilotMode)` range scanning in `parseAppUseMounts`.
  - Simplify `buildContract()` to `{ contractVersion, generatedAt, generator, routeCount, routes }`.
  - Update `writeContract` log line (no pilot-gated count).
  - Remove `erModeConcealmentMiddleware` from `SKIP_APP_USE_IDENT` if middleware no longer exists in `server/index.ts` (grep first; delete skip entry if gone).
- **MIRROR**: Existing JSDoc header style in `extract-express-routes.mjs`.
- **IMPORTS**: None new.
- **GOTCHA**: After contract shape change, CI `--write-contract` must refresh `docs/architecture/routes-contract.json` in same PR or CI will warn on drift.
- **VALIDATE**: `node scripts/architecture/extract-express-routes.mjs --list` prints route count; `pnpm routes:contract` exits 0.

### Task 2: Create schema inventory extractor

- **ACTION**: Add `scripts/docs/extract-schema-inventory.mjs`.
- **IMPLEMENT**:
  - Read `server/schema/{core,equipment,er,inventory,tasks,ops,integrations}.ts`.
  - Regex: `export const (\w+) = vtTable\("([^"]+)"` → collect table name + export symbol.
  - Group output by source file (match existing `docs/audit/db.md` section headers).
  - Emit markdown with banner: `Generated ${ISO date}` and pointer to `server/schema/`.
  - Do **not** list dropped tables (`vt_animals`, `vt_drug_formulary`, `vt_medication_tasks`).
- **MIRROR**: Section layout from [`docs/audit/db.md`](docs/audit/db.md) lines 1–80.
- **IMPORTS**: `node:fs`, `node:path`, `node:url` only.
- **GOTCHA**: Schema uses `vtTable` not `pgTable`; regex must match `vtTable("vt_...")`.
- **VALIDATE**: Output lists **62** `vtTable` definitions (current count across 7 schema files).

### Task 3: Create frontend route extractor

- **ACTION**: Add `scripts/docs/extract-frontend-routes.mjs`.
- **IMPLEMENT**:
  - Read `src/app/routes.tsx`.
  - Extract `const X = lazy(() => import("@/pages/..."))` → component map.
  - Extract `<Route path="..."` and `<Redirect to="..."` lines.
  - Sections: Public, Equipment (canonical), Legacy redirects (table Old → New), Emergency, Admin, Platform.
  - Include notes from inline comments (e.g. `/equipment/tasks` canonical).
  - Flag removed pages only as **redirect targets** (e.g. `/er` → `/equipment`), not as live components.
- **MIRROR**: [`docs/audit/frontend-routes.md`](docs/audit/frontend-routes.md) structure.
- **GOTCHA**: `ShiftRecapPage` in old audit — verify if still in routes.tsx; omit if removed.
- **VALIDATE**: Generated doc includes `/code-blue/display`, `/equipment/board`, legacy `/display` redirect.

### Task 4: Create route markdown formatter + orchestrator

- **ACTION**: Add `--write-md` to `extract-express-routes.mjs` OR separate `format-routes-markdown.mjs`; add `scripts/docs/generate-audit-inventories.mjs`.
- **IMPLEMENT** orchestrator:
  ```javascript
  // scripts/docs/generate-audit-inventories.mjs
  // 1. spawn extract-express-routes --write-md → docs/audit/routes.md
  // 2. run extract-frontend-routes → docs/audit/frontend-routes.md
  // 3. run extract-schema-inventory → docs/audit/db.md
  // 4. console.log summary counts
  ```
  - Group routes markdown by domain matching current audit sections (Infrastructure, Equipment, Emergency, Scheduling, Inventory, Integrations, Admin).
  - Fix copilot path: `POST /api/equipment/:id/copilot/explain` (not `/ask`).
- **MIRROR**: `run-architecture-gates.mjs` spawn pattern.
- **GOTCHA**: **`--write-md` does not exist today** — must be implemented in Task 4; do not assume it is already in the script.
- **VALIDATE**: `pnpm docs:audit` writes 3 files with today's date; `git diff docs/audit/` shows updated copilot path.

### Task 5: `package.json` script cleanup

- **ACTION**: Edit [`package.json`](package.json) scripts section.
- **IMPLEMENT**:
  - **Remove**: `"sync:formulary": "tsx scripts/sync-formulary-seed-all-clinics.ts"`
  - **Add**:
    ```json
    "docs:audit": "node scripts/docs/generate-audit-inventories.mjs",
    "deck:seed": "tsx scripts/seed-investor-deck-demo.ts",
    "deck:capture": "tsx scripts/capture-investor-deck-screenshots.ts",
    "deck:verify-assets": "tsx scripts/verify-investor-deck-assets.ts"
    ```
  - Optional: extend `architecture:gates` to spawn tenant lint + query-keys + routes (matching `.gitlab-ci.yml` lines 133–141) — if not, document gap in `docs/architecture/governance-known-limitations.md`.
- **GOTCHA**: [`docs/investor-deck/README.md`](docs/investor-deck/README.md) references `pnpm run deck:seed` — update seed script if it still inserts medication demo rows (grep `seed-investor-deck-demo.ts` for formulary/med tasks).
- **VALIDATE**: `pnpm docs:audit` and `pnpm deck:seed --help` or dry run; `pnpm sync:formulary` must not exist.

### Task 6: Delete orphan scripts

- **ACTION**: Delete files with no callers.
- **IMPLEMENT**: Delete:
  - `scripts/test-db-connection.ts` (broken `from "./server/db"`)
  - `scripts/check-users.ts`
  - `scripts/verify-icu-closure.ts`
  - `scripts/test-dispense-api.ts`
  - `scripts/validate-clinic-consistency.sql` (unless ops objects)
  - `scripts/post-merge.sh` (only referenced from [`.replit`](.replit) line 94 — remove `.replit` hook entry too if deleting)
- **GOTCHA**: Grep repo for each filename before delete.
- **VALIDATE**: `rg` returns zero hits for deleted paths; `npx tsc --noEmit` still clean.

### Task 7: Create doc index and scope doc

- **ACTION**: Create three new markdown files.
- **IMPLEMENT** `docs/README.md`:
  - Links: setup, cloud-agent, capacitor, mobile index, CI, scope-change, offline invariants, runbooks, RESUBMISSION_RUNBOOK, rfid-smoke
  - Note: Python exists only in `.claude/skills/ecc/` (not app code)
- **IMPLEMENT** `docs/scope-change-2026.md`:
  - Migrations 142/143 summary tables (removed tables, routes, pages)
  - Legacy redirect map copied from [`src/app/routes.tsx`](src/app/routes.tsx) lines 103–167
  - Explicit: dispense orphan validation stubbed; inventory-deduction worker no-op
- **IMPLEMENT** `docs/mobile/README.md`: link native-ship-checklist, nfc, release, implementation manual, capacitor-native-app
- **UPDATE** `docs/migrations.md`: next migration **155** (after `154_vt_equipment_name_he.sql`); schema split note
- **VALIDATE**: All linked paths exist post-deletion pass.

### Task 8: Rewrite canonical docs (equipment-first)

- **ACTION**: Rewrite six root-level files.
- **IMPLEMENT** content checklist:

  **README.md**
  - Tagline: equipment tracking, waitlist, Code Blue, tasks, inventory, integrations (not "medication workflows" as primary)
  - Scripts table: remove sync:formulary; add docs:audit, deck:*
  - Architecture tree: `server/schema/`, ~44 route modules, `server/jobs/runtime.ts`
  - DB tables: from regenerated audit (no vt_animals, vt_formulary, vt_hospitalizations)
  - Remove "medication inventory deduction async" bullet

  **CLAUDE.md**
  - Worker table from live `start-schedulers.ts` + `startJobRuntime()` queues
  - Schema: `server/schema/*.ts` + `db.ts` re-export
  - Rate limit 100/min; roles include lead_technician, vet_tech
  - Keep Phase-9 frozen surfaces verbatim
  - Remove: ER escalation schedulers, admission-fanout, formulary, medication-tasks services, inventory recovery in index.ts

  **AGENTS.md**
  - Fix: `pnpm test` = full vitest (`vitest run`), not "5 test suites"
  - Commands table: add docs:audit, cap:native scripts

  **CONTEXT.md** (full rewrite)
  - Glossary: equipment operational state, waitlist, reservation TTL, staging queue, docks, asset types, readiness
  - Asset Copilot: `POST /api/equipment/:id/copilot/explain`
  - Tasks: `vt_appointments`, `/equipment/tasks` — general tasks, not medication safety pipeline
  - Code Blue: equipment-centric sessions/logs (no patient FK)
  - Dispense: note validation stub returns `{ orphanLines: [] }`
  - Multi-tenancy, authority evaluators, offline-first, Hebrew-first — keep
  - **Remove**: ER Wedge, ER Allowlist, Concealment 404, Intake Event, admission pool language

  **PRODUCT.md**
  - Users: staff executing equipment/tasks/inventory workflows under time pressure
  - Purpose: hospital **asset and operations** OS (not full EMR/medication platform)

  **`.cursorrules`**
  - Remove medication safety section (MAX_SAFE_VOLUME_ML, medication-tasks.service paths)
  - Remove ER scheduler tick constants
  - Update worker registration to match `start-schedulers.ts`
  - Fix global rate limit 120 → **100**
  - Schema rule: edit `server/schema/*.ts` or `server/db.ts` per table location; generate migrations same as before

- **MIRROR**: Existing markdown tone in `docs/setup/environment.md` (concise, command-oriented).
- **GOTCHA**: `.cursorrules` says "all pgTable in server/db.ts only" — update to schema split reality.
- **VALIDATE**: `rg 'vt_formulary|sync:formulary|server/routes/er|medication-tasks\.service|pilot-mode' README.md CLAUDE.md AGENTS.md CONTEXT.md PRODUCT.md .cursorrules` → zero hits.

### Task 9: Bulk delete obsolete docs

- **ACTION**: Delete directories and files listed in source plan Phase 4.
- **IMPLEMENT** (directories):
  - `docs/superpowers/` (49 files)
  - `docs/pilot-mode/` (12 files)
  - `docs/docs/` (nested duplicate)
- **IMPLEMENT** (standalone — use `git rm` or delete):
  - ER/authority: `endpoint-authority-matrix.md`, `operational-modes.md`, `authority-model.md`, `task-product-model.md`, `ownership-lifecycle.md`, `phase-2.5-decision-brief.md`
  - Champion cluster (8 files): `docs/champion-*.md`
  - Pilot: `pilot.md`, `pilot-operator-checklist.md`, `pilot-go-no-go-report.md`, `pilot-step8-debug-pass.md`
  - Plans: `VETTRACK_MASTER_STABILIZATION_PLAN.md`, `scaling-implementation-program.md`, `master-plan.md`
  - Specs: `technical-specification.md`, `FEATURES_CAPABILITIES_UNIQUENESS.md`, `architecture-review.md`, `technical-debt.md` (or rewrite to 1-page current debt)
  - Artifacts: `docs/audit-wedge-*.patch`, `docs/audit-wedge-*.txt`
  - ADR: `docs/architecture/adr-001-medication-task-models.md`
  - ER architecture slices: `docs/architecture/slice-6h-er-display-types-plan.md`, etc.
  - Root: `replit.md`
- **GOTCHA**: After deletion, run link-fix pass on files that referenced superpowers (Task 10).
- **VALIDATE**: `test ! -d docs/superpowers`; `rg 'docs/superpowers' docs/` → zero (except maybe git history).

### Task 10: Refresh kept docs and agent skills

- **ACTION**: Rewrite/update surviving docs and skills.
- **IMPLEMENT**:
  - `docs/architecture/backend-routing.md`: ~44 modules, no pilot section, no `billing.ts`, copilot explain path; point to `routes-contract.json`
  - `docs/CHATGPT_PROJECT_INSTRUCTIONS.md`: schema = `server/schema/`; remove superpowers historical note; add `docs/scope-change-2026.md`
  - `ARTIFACTS.md`: short "transformation complete" stub + link `docs/mobile/*` OR delete if redundant with mobile README
  - `IMPLEMENTATION_PLAN.md` / `BUG_REGISTER.md`: delete if entirely stale, else remove ER/med/pilot sections
  - `.agents/skills/clinical-enterprise-integrity/SKILL.md` + REFERENCE: remove ER Mode allowlist workflow; point ward display to `docs/architecture/offline-realtime-invariants.md` + `/equipment/board`
  - `.agents/skills/bedside-ux-clinical-ui/SKILL.md` + REFERENCE: same
  - `.agents/skills/publish-mobile-app/REJECTIONS.md`: Clerk + RESUBMISSION_RUNBOOK per FORK.md
  - `.agents/skills/expo/FORK.md`: link `docs/mobile/native-mobile-implementation-manual.md`
  - Delete `.claude/PRPs/plans/native-mobile-desktop-strategy.plan.md`
  - Update `docs/investor-deck/README.md`: deck seed no longer promises "medication tasks" demo data if seed script trimmed
- **VALIDATE**: `rg 'docs/superpowers|er-mode-access|sync:formulary' .agents docs --glob '*.md'` → zero unintended hits.

### Task 11: Regenerate contracts and audits

- **ACTION**: Run generators and commit outputs.
- **IMPLEMENT**:
  ```bash
  pnpm docs:audit
  pnpm routes:contract -- --write-contract
  ```
- **GOTCHA**: Contract JSON shape changed in Task 1 — baseline must be rewritten in same commit.
- **VALIDATE**: `docs/audit/routes.md` header date = today; copilot shows `/explain`.

### Task 12: Verification sweep

- **ACTION**: Run full validation checklist.
- **IMPLEMENT**:
  ```bash
  rg -l 'server/routes/er\.ts|medication-tasks\.service|sync:formulary|src/lib/pilot-mode|vt_formulary|vt_animals|docs/superpowers' \
    --glob '!migrations/*' --glob '!.git/*' .
  npx tsc --noEmit
  pnpm test
  pnpm knip
  pnpm docs:audit
  pnpm auth:preflight   # smoke: script still runs
  ```
- **VALIDATE**: All commands succeed; ripgrep only hits migration SQL history (acceptable) or zero.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Schema extractor | `server/schema/core.ts` | Lists `vt_clinics`, `vt_users` | Missing file → throw clear error |
| FE route extractor | `routes.tsx` with Redirect | Legacy redirect table populated | Lazy import alias paths |
| Route contract | After pilot removal | JSON without `pilotRegistration` | Old contract diff |

**Optional (recommended):** Add `tests/scripts/docs-audit.test.ts` that runs extractors and asserts minimum route/table counts (>40 routes, >50 tables).

### Edge Cases Checklist
- [x] Deleted features only appear in scope-change doc + migration history
- [x] Redirect routes documented but not as live pages
- [x] Investor deck seed doesn't reference dropped tables
- [x] Agent skills don't link to deleted paths
- [x] CI contract JSON committed with shape change
- [x] `.cursorrules` rate limit matches code

---

## Validation Commands

### Static Analysis
```bash
npx tsc --noEmit
```
EXPECT: Zero type errors

### Unit Tests
```bash
pnpm test
```
EXPECT: All tests pass (full vitest suite)

### Doc generation
```bash
pnpm docs:audit
pnpm routes:contract -- --write-contract
```
EXPECT: Three audit markdown files updated; contract JSON refreshed

### Dead reference sweep
```bash
rg 'sync:formulary|docs/superpowers|server/routes/er|pilot-mode\.ts' --glob '!migrations/*' .
```
EXPECT: No matches outside migration SQL / this plan file

### Knip
```bash
pnpm knip
```
EXPECT: No new orphans from script deletions

### Manual Validation
- [ ] Open `docs/README.md` — all links resolve
- [ ] README quick start matches `docs/setup/environment.md`
- [ ] `pnpm deck:seed` documented and runs (or seed script updated to skip med rows)
- [ ] Mobile index links to ship checklist user had open

---

## Acceptance Criteria
- [ ] All 12 tasks completed
- [ ] `pnpm docs:audit` exists and regenerates three audit files
- [ ] `sync:formulary` removed from package.json and README
- [ ] `deck:seed`, `deck:capture`, `deck:verify-assets` in package.json
- [ ] Canonical six files contain zero stale ER/formulary/pilot references
- [ ] `docs/superpowers/` and `docs/pilot-mode/` directories deleted
- [ ] `CONTEXT.md` describes equipment-first domain
- [ ] Agent skills updated; no links to deleted doc paths
- [ ] `npx tsc --noEmit` and `pnpm test` pass
- [ ] Self-contained — implementer needs no further codebase search

## Completion Checklist
- [ ] Code/doc patterns match discovered conventions
- [ ] No invented CLI flags documented without implementation
- [ ] Gotchas documented (pilot removal, dispense stub, `--write-md` net-new)
- [ ] PR split: PR1 scripts, PR2 canonical, PR3 bulk delete + skills (optional but recommended)
- [ ] No unnecessary scope additions

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Broken links after mass delete | High | Medium | Task 10 link-fix pass + docs/README as hub |
| Investor deck seed inserts dropped tables | Medium | High | Grep/update `seed-investor-deck-demo.ts` in Task 5 |
| Contract JSON CI drift | Medium | Medium | Task 11 same commit as extract script change |
| `.cursorrules` vs CLAUDE drift | Low | Medium | Single Task 8 pass edits both |
| Accidental delete of still-useful doc | Low | Medium | Keep list explicit; grep references before delete |

## Notes

- **User decisions locked in:** delete historical docs (no archive); rewrite CONTEXT/PRODUCT equipment-first.
- **Live route module count:** 44 imports in `server/app/routes.ts` (plus `webhooks.ts` / `rfid.ts` mounted from `server/index.ts` — document in routes audit).
- **Dispense / Smart COP:** Do not document active orphan enforcement — `evaluateDispenseAgainstOrders` is a no-op stub post-scope-cut.
- **Python:** 3 files under `.claude/skills/ecc/` only; document in `docs/README.md`, no deletions.
- **PRP execution:** Run `/prp-implement .claude/PRPs/plans/docs-scripts-renewal.plan.md` after approval.

---

## Suggested PR Sequence

| PR | Tasks | Files |
|---|---|---|
| PR1 | 1–6, 11 | scripts/, package.json, routes-contract.json, docs/audit/* |
| PR2 | 7–8 | README, CLAUDE, AGENTS, CONTEXT, PRODUCT, .cursorrules, new docs index |
| PR3 | 9–10, 12 | Mass deletes, skills, secondary doc refresh |

**Confidence Score: 8/10** — scope is large but well-bounded; main risk is missed cross-references after bulk delete (mitigated by ripgrep gates).
