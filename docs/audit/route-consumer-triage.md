# Route consumer triage — the 43 no-consumer server routes

**Source finding:** `AUDIT-repo-b.md` ROUTE-MATRIX — 311 method+path pairs enumerated,
241 consumed, 43 with no consumer in web / RN / `scripts/` / `tests/` / `packages/rfid-controller`,
plus 6 suspected. Top-10 action was *"triage: delete or name a destination per route"*.

**Verified against:** worktree `chore/audit-tier2` @ `e3472e63ec20446916a6f3a566742590d55b0cd9`
(based on `origin/main`), web `src/`, RN repo `/Users/dan/VetTrack-RN-Migration` @ `a06cbb5`
(branch `main`), `scripts/`, `tests/`, `packages/`, `public/sw.js`, `docs/`.

Every row below was re-verified independently of the audit. Rows where the audit's
reasoning did not survive re-verification are called out explicitly.

## Verdict vocabulary

| Verdict | Meaning |
|---|---|
| `DELETE-NOW` | Provably dead and tied to a feature the repo documents as retired |
| `DESTINATION` | A real forthcoming consumer exists — the slice is named, **and so is the delete-gate** |
| `OPERATOR` | Deliberately curl / runbook-only — the runbook is named, or its absence is stated |
| `KEEP-FROZEN` | A contract surface `CLAUDE.md` or `packages/contracts` protects |
| `NEEDS-OWNER` | Cannot be decided without the owner |

---

## The finding that reframes this whole register

**Every route in this register is pinned by at least one structural test.** The repo has a
family of contract tests that assert route *source text* — mount strings in
`server/app/routes.ts`, `router.post("/x"` literals inside route files, and allowlists of
route filenames:

- `tests/route-registration.test.js` — `requiredPrefixes` includes `"/api/stability"`
- `tests/server-bootstrap-structure.test.js` — same prefix list
- `tests/routes-registration-contract-slice7.test.ts` — full ordered mount list, includes
  `"/api/stability"` **and** `"/api/equipment-board"`
- `tests/equipment-readiness-wedge-smoke.test.ts:23` — asserts the exact line
  `app.use("/api/equipment-board", createDisplayRouter())`
- `tests/i18n-no-untranslated-api-error.test.ts` — a `KNOWN_DEBT_ALLOWLIST` of route
  filenames **plus** an explicit *"allowlist contains no stale entries"* assertion
- `tests/phase-5-route-error-contract.test.js`, `tests/i18n-pr-6-10-route-migration.test.ts`
  — module-scope `readFileSync` / dynamic `import()` of specific route files
- `tests/phase-1-reliability-ops.test.js` — asserts `router.post("/dlq/:jobId/replay"`
- `tests/shift-csv-role-labels.test.ts`, `tests/shift-csv-doctor-import.test.ts` — assert
  `router.post("/import",` in `server/routes/shifts.ts`
- `tests/offline-phase-7-emergency-surface-parity.test.ts` — `it.each` over
  `EMERGENCY_SERVER_ROUTE_ALLOWLIST`

**Consequence:** deleting a dead route is never a one-file change in this repo. That is the
mechanism by which 43 uncalled routes accumulated — not neglect, but a per-deletion cost the
structural tests impose. Any real cleanup campaign must budget the companion test edits, and
should consider whether the mount-string assertions are earning their keep.

---

## Executive summary by verdict

| Verdict | Rows | Families |
|---|---|---|
| `DELETE-NOW` — **executed**, see Section C | 15 | `/api/stability` (7), `/api/equipment-board` (8) |
| `KEEP-FROZEN` | 12 | health probe mounts (8), Code Blue billing-reconciliation (4) |
| `NEEDS-OWNER` | 15 | task-ownership (7), dispense (3), inventory prices (2), cursor-bug-fixer dispatch (1), operational-roles (1), bare shifts import (1) |
| `DESTINATION` | 11 | queue DLQ (2), fault-image (1), rfid-provisioning (2), admin-force-close (1), integrations (5) |
| `OPERATOR` | 3 | users purge/backfill (3) |

---

## Section A — the most consequential row: `admin-task-ownership.ts` (7 endpoints)

**Do not delete. This is a live product gap, not dead code.**

| Method | Path | Defines |
|---|---|---|
| POST | `/api/admin/task-ownership/backfill` | `server/routes/admin-task-ownership.ts:42` |
| GET | `/api/admin/task-ownership/backfill/:jobId` | `server/routes/admin-task-ownership.ts:95` |
| GET | `/api/admin/task-ownership/queue` | `server/routes/admin-task-ownership.ts:142` |
| GET | `/api/admin/task-ownership/queue/count` | `server/routes/admin-task-ownership.ts:169` |
| POST | `/api/admin/task-ownership/queue/:id/confirm` | `server/routes/admin-task-ownership.ts:369` |
| POST | `/api/admin/task-ownership/queue/:id/reject` | `server/routes/admin-task-ownership.ts:380` |
| POST | `/api/admin/task-ownership/queue/:id/skip` | `server/routes/admin-task-ownership.ts:389` |

**Verdict: `NEEDS-OWNER` — with a strong recommendation to build the console page, not delete the API.**

Why this is different from every other row: the queue these endpoints expose is **actively
being written to right now**, in production, by two schedulers that `server/app/start-schedulers.ts`
starts unconditionally:

```
server/app/start-schedulers.ts:66  await startTaskOwnershipBackfillWorker();
server/app/start-schedulers.ts:67  await startStaleTaskOwnershipSweepWorker();
server/workers/taskOwnershipBackfill.worker.ts:150   .insert(taskOwnershipConfirmQueue)
server/schema/ops.ts:467                             vt_task_ownership_confirm_queue
```

The write path is live (`.insert(...)` with `ON CONFLICT DO NOTHING` per the worker's own
header comment). The read/act path — list, count, confirm, reject, skip — exists as HTTP but
has **zero callers in web or RN**:

```
$ grep -rn "task-ownership" src/          # web  -> 0
$ grep -rn "taskOwnership"  src/          # web  -> 0
$ grep -rn "task-ownership" src/          # RN   -> 0
```

So `vt_task_ownership_confirm_queue` accumulates rows that no human can see or resolve, and
the queue's whole purpose is human resolution of ambiguous task ownership. Every day this
stays unwired the backlog grows and the resolution decisions get staler and harder.

`docs/governance/ARCHITECTURE_MAP.md:61` lists `admin-task-ownership.ts` under
**Admin / tooling** as built-by-design, which corroborates that the missing piece is the
console page, not the API.

**Recommended action for the owner:** wire an admin-console page against the existing 7
endpoints. Failing that, the *write* path should be gated off too — leaving the writers
running while the readers are unreachable is the worst of the three options.

**Delete-gate if the owner chooses not to build the page:** delete the routes **and** stop
`startTaskOwnershipBackfillWorker` / `startStaleTaskOwnershipSweepWorker` from enqueuing,
in the same change. Deleting only the routes leaves a table filling forever.

---

## Section B — Code Blue billing-reconciliation (4 endpoints): the audit's own trap

| Method | Path | Defines |
|---|---|---|
| GET | `/api/code-blue/reconciliation` | `server/routes/code-blue.ts:1222` |
| GET | `/api/code-blue/sessions/:id/dispenses` | `server/routes/code-blue.ts:1264` |
| PATCH | `/api/code-blue/sessions/:id/reconcile` | `server/routes/code-blue.ts:1313` |
| POST | `/api/code-blue/sessions/:id/manual-billing` | `server/routes/code-blue.ts:1375` |

**Verdict: `KEEP-FROZEN`.**

The audit is right that no client calls them, and would have been wrong to conclude they are
deletable. A second search strategy — grepping `packages/` rather than `src/` — finds all
four enumerated in a **canonical contract**:

```
packages/contracts/src/emergency.ts:60   "GET /api/code-blue/reconciliation",
packages/contracts/src/emergency.ts:61   "GET /api/code-blue/sessions/:id/dispenses",
packages/contracts/src/emergency.ts:62   "PATCH /api/code-blue/sessions/:id/reconcile",
packages/contracts/src/emergency.ts:63   "POST /api/code-blue/sessions/:id/manual-billing",
```

inside `EMERGENCY_SERVER_ROUTE_ALLOWLIST`, whose file header reads *"CANONICAL source of
truth for the emergency offline-block list, SW cache-bypass paths, and the base server-route
allowlist"* and is re-exported by `shared/emergency-surfaces.manifest.ts`. The OFF-07 parity
gate `tests/offline-phase-7-emergency-surface-parity.test.ts:202` runs
`it.each(EMERGENCY_SERVER_ROUTE_ALLOWLIST)` asserting each allowlisted route satisfies the
coverage rules. `CLAUDE.md` names `packages/contracts` as the shared seam and freezes the
emergency surface family.

**Secondary observation — the UI copy was written and never used.** `locales/en.json` carries
a full `codeBlue.reconciliation` namespace (`title`, `documentTitle`, `adminRequired`,
`backToBilling`, `pageDescription`, `loadSessionsFailed`, `allClean`, `noEndedSessions`, …),
and `src/lib/i18n.ts:614-622` wires it into `buildTranslations()` — yet no `.tsx` consumes
`t.codeBlue.reconciliation`. API + copy shipped; the page never landed. Same shape as
Section A, lower urgency (no data accumulates).

---

## Section C — `DELETE-NOW` — EXECUTED

> **Status 2026-08-19: done.** Both families are removed. The patch set below was
> blocked when this register was written because the deleting lane was scoped out of
> test files; that scope limit no longer applies. Executed with three additions the
> original set missed — `server/lib/test-runner.ts` and `server/lib/stability-log.ts`
> (whose only consumers were `stability.ts` and each other), and
> `docs/architecture/routes-contract.json` (regenerated, 284 routes). Both generated
> files were rebuilt by their own scripts rather than hand-edited.
>
> Still open, deliberately: the `errors.stability.*` keys in `locales/{en,he}.json` are
> now dead. They are NOT removed here — the `chore/audit-tier1` branch owns those two
> files and has already rewritten them heavily; deleting keys here would manufacture a
> merge conflict for no gain. Fold them into the locale cleanup on that branch.

Both deletions this lane was asked to execute are **correct verdicts** but are **not
one-file changes**, and their companion edits fall outside this lane's file set. Per the
concurrency contract, the patches are reported rather than applied. See
`wf2-proof/D6.md` for the exact patch text.

### C.1 — `/api/stability` (7 endpoints) — `DELETE-NOW` — EXECUTED

| Method | Path | Defines |
|---|---|---|
| GET | `/api/stability/status` | `server/routes/stability.ts:28` |
| POST | `/api/stability/run` | `server/routes/stability.ts:40` |
| GET | `/api/stability/results` | `server/routes/stability.ts:58` |
| GET | `/api/stability/logs` | `server/routes/stability.ts:62` |
| DELETE | `/api/stability/logs` | `server/routes/stability.ts:68` |
| POST | `/api/stability/test-mode` | `server/routes/stability.ts:74` |
| POST | `/api/stability/schedule` | `server/routes/stability.ts:91` |

Retirement is directly evidenced, not merely inferred from an absent caller:

- `src/app/routes.tsx:284` — `<Route path="/stability"><Redirect to="/home" replace /></Route>`
  (the page is a redirect stub)
- `docs/governance/ARCHITECTURE_MAP.md:361` — under *Dead features & stubs*:
  `/api/stability | Dev/stability tooling; low product traffic`
- `docs/governance/ARCHITECTURE_MAP.md:373` — under *Orphaned / low-reference modules*:
  `server/routes/stability.ts | Stability runner — dev/ops only`
- `tests/flow-walk/flow-inventory.manifest.ts:169` — records the redirect as DRIFT
- The `stabilityPage` i18n namespace is still wired at `src/lib/i18n.ts:885` — orphaned copy
  reachable only through a route that redirects away.

**Blocking companion edits (6 files, all outside this lane):** see Section C.3.

### C.2 — `/api/equipment-board` alias mount (8 endpoints) — `DELETE-NOW` — EXECUTED

`server/app/routes.ts:111` mounts `createDisplayRouter()` a second time, producing 8 alias
endpoints of `/api/display/*` (`server/routes/display.ts:732-743`: `pair/issue`,
`pair/claim`, `snapshot`, `heartbeat`, `devices`, `devices/:id` PATCH/DELETE,
`devices/:id/revoke`).

Literal-string verification across **every** surface, per the required "search more than one
way" discipline:

```
$ grep -rn "/api/equipment-board" .  --exclude-dir=node_modules --exclude-dir=.git
tests/routes-registration-contract-slice7.test.ts:42
tests/equipment-readiness-wedge-smoke.test.ts:23
server/app/routes.ts:111
docs/archive/2026/…, docs/governance/ARCHITECTURE_MAP.md   (docs only)
```

- **web `src/`** — zero. The `equipment-board` hits under `src/` are the *client route alias*
  (`src/lib/routes/route-alias-groups.ts:11` maps `equipmentBoard: ["/equipment/board",
  "/equipment-board", "/display"]`) and the `shared/equipment-board.ts` **type** module —
  neither is this URL.
- **RN repo** (`/Users/dan/VetTrack-RN-Migration` @ `a06cbb5`) — zero code hits; only two
  Hebrew research docs mention the client-route rename.
- **`public/sw.js`** — zero.
- **`packages/`** — zero.

**`/api/display` itself is untouched by this verdict.** Only the second `app.use(...)` line
is removed; `createDisplayRouter()` and the `/api/display` mount stay exactly as they are.

**New risk this verification surfaced (not in the audit, and the audit's parenthetical is
wrong).** The audit note speculated the alias is "unconditionally bypassed together since the
denylist matches by suffix in sw.js". It does not. `public/sw.js:38-67`:

```js
const EMERGENCY_BYPASS_PATHS = [ "/api/display/snapshot", … ];
return EMERGENCY_BYPASS_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
```

That is an **exact-or-prefix** match on `/api/display/snapshot`. `/api/equipment-board/snapshot`
matches neither. The same is true of the canonical list in
`packages/contracts/src/emergency.ts:36-42`. So the alias serves the identical emergency
snapshot handler while sitting **outside** the frozen cache-denylist — a latent violation of
`CLAUDE.md`'s *"No emergency endpoint in any cache"* doctrine that would activate the moment
anything called the alias path. This strengthens the delete verdict: removing the alias closes
the hole, whereas keeping it would require *adding* it to the denylist in three places.

### C.3 — exact companion edits both deletions require

| File | Why it breaks | Edit needed |
|---|---|---|
| `tests/route-registration.test.js:23` | `requiredPrefixes` contains `"/api/stability"`; asserted against `server/index.ts` + `server/app/routes.ts` source | drop the entry |
| `tests/server-bootstrap-structure.test.js:30` | same prefix list | drop the entry |
| `tests/routes-registration-contract-slice7.test.ts:42,55` | ordered mount-list lock contains `"/api/equipment-board"` and `"/api/stability"` | drop both entries |
| `tests/equipment-readiness-wedge-smoke.test.ts:23` | asserts the exact `app.use("/api/equipment-board", createDisplayRouter())` line | drop that assertion, keep the `/api/display` one |
| `tests/i18n-no-untranslated-api-error.test.ts:76` | `KNOWN_DEBT_ALLOWLIST` contains `server/routes/stability.ts`, and a dedicated *"allowlist contains no stale entries"* test fails on a missing file | drop the entry |
| `tests/phase-5-route-error-contract.test.js:25` | module-scope `readFileSync(server/routes/stability.ts)` → the file errors at collection | drop the read + its `describe` |
| `tests/i18n-pr-6-10-route-migration.test.ts:86,113` | dynamic `import("../server/routes/stability.js")` + `readFileSync` of the `.ts` | drop the stability blocks, keep the dispense ones |
| `src/lib/query-keys/registry.ts:95-98` | four `/api/stability/*` query-key shapes (`/logs` ×2, `/results`, `/status`) in the generated drift baseline | regenerate with `pnpm query-keys:audit -- --write-registry` |

**Correction to §4 (added at land time, 2026-08-19).** §4 claims the no-consumer search was run five ways
with zero product hits. A sixth method — grepping the generated baselines rather than application code —
surfaces `src/lib/query-keys/registry.ts:95-98`, which registers four `/api/stability/*` key shapes. It does
**not** overturn the `DELETE-NOW` verdict: the file is a generated architecture-drift baseline that carries
*"Do not import from application code"* in its own header, and CI runs its collector `--warn-only` with
`continue-on-error: true` (`.github/workflows/ci.yml:255-257`), so it cannot fail a build. But it is a 10th
file the patch set above must carry, and it is positive evidence that a consumer once existed — exactly the
class of signal §4 asserted it had ruled out. Treat the "five ways" claim as five ways over *application*
source, not over generated inventories.

Follow-ups the same change should carry (not blockers): the `stabilityPage` (20 keys) and
`errors.stability.*` namespaces in `locales/{en,he}.json`, and `src/lib/i18n.ts:885`.

---

## Section D — `KEEP-FROZEN`: health probe mounts (8 rows)

`server/app/routes.ts:84-86` mounts `healthRoutes` three times (`/api/health`,
`/api/health/ready`, `/health`); `server/index.ts:69` mounts `/api/health` again ahead of the
helmet chain, and `server/index.ts:70` registers `/api/healthz` (the Railway healthcheck path).

| Method | Path | Defines | Note |
|---|---|---|---|
| GET | `/api/health/ready` | `server/routes/health.ts:118` | alias mount |
| GET | `/api/health/ready/live` | `server/routes/health.ts:14` | alias mount |
| GET | `/api/health/ready/startup` | `server/routes/health.ts:18` | alias mount |
| GET | `/api/health/ready/data-integrity` | `server/routes/health.ts:178` | alias mount |
| GET | `/health` | `server/routes/health.ts:118` | bare third mount |
| GET | `/health/live` | `server/routes/health.ts:14` | bare third mount |
| GET | `/health/startup` | `server/routes/health.ts:18` | bare third mount |
| GET | `/health/data-integrity` | `server/routes/health.ts:178` | bare third mount |

**Verdict: `KEEP-FROZEN`.** `tests/i18n-no-untranslated-api-error.test.ts:62` annotates the
file `owner: infra (probe endpoints — frozen contract)`, and
`docs/governance/ARCHITECTURE_MAP.md:343` calls the triple-mount *"intentional redundancy for
probes"*. Probe surfaces are consumed by infrastructure (load balancers, uptime checks,
container orchestrators) that repo grep cannot see — absence of an in-repo caller is not
evidence here. `GET /api/health/data-integrity` (audit: SUSPECTED) is the one row with no
runbook reference found either; it stays `KEEP-FROZEN` on the same reasoning, with that
recorded.

---

## Section E — `DESTINATION` (11 rows) — each with its delete-gate

| Method | Path | Defines | Why no consumer | Named destination | **Delete-gate** |
|---|---|---|---|---|---|
| GET | `/api/queue/dlq` | `server/routes/queue.ts:94` | web's `adminQueueMetrics` client only calls `/api/queue/metrics` | The admin ops console already ships the *symmetric* outbox-DLQ panel (`adminOutboxDlq` in `src/lib/api.ts`, list/retry/drop). The BullMQ DLQ panel is the missing twin. | If the next admin-console slice ships without a BullMQ DLQ panel, delete both rows **and** `tests/phase-1-reliability-ops.test.js:32`'s assertion. |
| POST | `/api/queue/dlq/:jobId/replay` | `server/routes/queue.ts:127` | same | same | same |
| POST | `/api/uploads/fault-image` | `server/routes/uploads.ts:69` | Native `ReportEquipmentIssueSheet.tsx` comments photo-attach is a "desktop-only extra"; the desktop `components/report-issue-dialog.tsx` has no upload code either | The web report-issue dialog — photo attach on equipment fault reports | If the next equipment-issue slice ships without photo attach, delete. |
| POST | `/api/admin/rfid-provisioning/rollback` | `server/routes/admin-rfid-provisioning.ts:78` | web `rfidReaders` client exposes only `provision()`/`setIngest()`; `packages/rfid-controller` posts only to `/api/rfid/events` | Secret-rotation grace-period operations, per `CLAUDE.md`'s RFID rotation surface (`server/lib/rfid/provisioning.ts` + the `finalizing` sweep) | If a rotation runbook is not written by the time the RFID pilot goes live, downgrade to `NEEDS-OWNER` and decide then. |
| POST | `/api/admin/rfid-provisioning/ack` | `server/routes/admin-rfid-provisioning.ts:97` | same | Reader-side adoption ack for a rotated secret | Same gate. Note the plausible caller is *reader hardware*, not this repo — grep can never confirm it. |
| POST | `/api/clinical-check-in/check-ins/:id/admin-force-close` | `server/routes/clinical-check-in.ts:252` | web `checkIn` client + RN `clinical-check-in.ts` cover only the self-service verbs | Admin console — force-close a stuck check-in. Directly relevant to the doctor shift-gate surface. | If no admin console surface calls it within the next authority slice, escalate to `NEEDS-OWNER`. |
| GET | `/api/integrations/billing/mismatch-report` | `server/routes/integrations.ts:88` | in-code tag "Phase D Sprint 3" | Integrations console, Phase D | If Phase D is descoped, delete with the rest of the Phase-D staging. |
| GET | `/api/integrations/analytics/product` | `server/routes/integrations.ts:187` | self-documented "Product analytics stub (zeros until Phase D)" | Integrations console, Phase D | Same gate. |
| GET | `/api/integrations/configs/:adapterId/logs` | `server/routes/integrations.ts:684` | every sibling verb is wired in `src/lib/api.ts`'s `integrations` object; `.logs` alone is not | Integrations console — per-adapter log drawer | If not wired in the next integrations slice, delete (single-verb gap, cheapest of the five). |
| POST | `/api/integrations/configs/:adapterId/promote` | `server/routes/integrations.ts:635` | doc comment "Vendor X promote environment" — vendor-specific | Vendor-X onboarding runbook | If Vendor X does not onboard, delete both vendor rows together. |
| POST | `/api/integrations/configs/:adapterId/rollback` | `server/routes/integrations.ts:579` | doc comment "Vendor X rollback (disable config + schedules)" | same | same |

`POST /api/integrations/ops/sync/window` (`server/integrations/routes/ops.routes.ts:208`) is
listed under `NEEDS-OWNER` below — its two ops-subrouter siblings (`retryRun`,
`replayWebhook`) *are* wired, so its absence is an asymmetry rather than a staged surface.

---

## Section F — `OPERATOR` (3 rows)

| Method | Path | Defines | Runbook |
|---|---|---|---|
| GET | `/api/users/purge-candidates` | `server/routes/users.ts:1134` | **None exists.** No `scripts/` or `docs/` runbook references it. |
| POST | `/api/users/purge-deleted` | `server/routes/users.ts:1159` | **None exists.** |
| POST | `/api/users/backfill-clerk` | `server/routes/users.ts:1216` | **None exists.** Reads as a run-once migration already exercised. |

All three are `requireAuth + requireAdmin + authSensitiveLimiter`. **Flag:** these are
permanent-deletion / identity-migration surfaces with no discoverable trigger path and no
written procedure. An undocumented destructive admin endpoint is a worse risk than a dead one.
The minimum correct action is to write the runbook (which converts them to legitimate
`OPERATOR`) or delete them. Note also `reference_audit_log_append_only`: clinics with audit
rows are undeletable, so a purge path may not behave as its name implies.

---

## Section G — `NEEDS-OWNER` (remaining rows)

| Method | Path | Defines | Why undecidable |
|---|---|---|---|
| POST | `/api/dispense/draft` | `server/routes/dispense.ts:89` | Standalone non-clinical dispense family; clients use the container-scoped `/api/containers/:id/dispense`. **But** 7 test files couple to this file — `dispense-auth-hardening`, `dispense-audit-authority`, `authority-middleware-zero-consumers`, `containers-dispense-authority`, `strict-body-validation` (imports `draftSchema`/`confirmSchema`/`emergencySchema`), plus two i18n tests. The authority tests treat it as a live enforcement surface. Superseded-vs-load-bearing is an owner call. |
| POST | `/api/dispense/:id/confirm` | `server/routes/dispense.ts:116` | same |
| POST | `/api/dispense/emergency` | `server/routes/dispense.ts:152` | same |
| GET | `/api/inventory-items/:id/prices` | `server/routes/inventory-items.ts:388` | A multi-price feature with no UI anywhere; no "price" reference in `src/pages/inventory-items.tsx` or the `inventoryItems` client. Product question, not a code question. |
| POST | `/api/inventory-items/:id/prices` | `server/routes/inventory-items.ts:330` | same |
| POST | `/api/admin/cursor-bug-fixer/dispatch` | `server/routes/cursor-bug-fixer.ts:80` | Bare manual-dispatch variant; web calls only the ticket-scoped `…/support-tickets/:id/dispatch` (`src/lib/api.ts:769`). Reads superseded, but the bare variant may be an intentional operator entry point. |
| GET | `/api/clinical-check-in/me/operational-roles` | `server/routes/clinical-check-in.ts:235` | Plausibly superseded — `GET /api/users/me` already returns `effectiveRole`/`roleSource`/`authority` inline in one call. Needs confirmation that nothing plans to use the standalone read. |
| POST | `/api/shifts/import` | `server/routes/shifts.ts:822` | Bare single-step multer CSV import; both web and `scripts/wetcheck/simulate.mjs` use only the two-step `import/preview` → `import/confirm`. Pinned by `tests/shift-csv-role-labels.test.ts:160` and `tests/shift-csv-doctor-import.test.ts:208`, which locate `router.post("/import",` by index to bound their source scans — so removal shifts those tests' scan windows. |
| POST | `/api/integrations/ops/sync/window` | `server/integrations/routes/ops.routes.ts:208` | Bounded-window sync job; its two ops-subrouter siblings are wired, it is not. Asymmetry, not staging. |
| — | `admin-task-ownership` (7 rows) | see **Section A** | the register's most consequential rows |

---

## Residual scope note

This register covers the ROUTE-MATRIX rows only. The audit's adjacent findings — the legacy
in-memory `broadcast()` SSE path in `server/lib/realtime.ts`, the 11 unwired i18n namespaces
in `buildTranslations()`, the dead `event-reducer.ts` cases, and the ~40 undocumented env vars
— are separate lanes and are deliberately **not** triaged here.
