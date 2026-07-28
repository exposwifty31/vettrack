# Case Spine Spike — Findings (Task 0.2)

> VetTrack 2.0, Task 0.2. Proves two things before the real implementation (Task 1.2) begins: (1) the
> physical×clinical join works — attach one dispense event to a case via `case_id`, read back a queryable
> timeline; (2) offline reconcile works — an attach-to-case action queued while offline reconciles on
> reconnect without loss or duplication. Built via TDD (RED before code) in an isolated, unmerged spike
> branch — see §6. Independently re-verified against the actual worktree (not just the implementer's
> report) — see §5.

## 1. Schema proven

**`vt_cases`** — new table, `server/schema/cases.ts:15-38`. Columns, matching the Task 0.1 allowlist
(`docs/design/case-spine-allowlist.md`) — operational only, no clinical/PHI fields:
- `id` text PK (`cases.ts:22`)
- `clinicId` text NOT NULL → FK `vt_clinics.id`, `onDelete: restrict` (`cases.ts:23-25`)
- `patientExternalId` text **nullable** — opaque PMS join key, never PHI (`cases.ts:27`)
- `status` varchar(20) NOT NULL default `"open"` — operational lifecycle only (`cases.ts:29`)
- `createdAt` / `updatedAt` timestamptz, default now (`cases.ts:30-31`)
- Indexes: `idx_vt_cases_clinic_status`, `idx_vt_cases_clinic_patient` — both clinic-prefixed composites
  (`cases.ts:34-35`)

**`vt_dispense_events.caseId`** — additive nullable column, `server/schema/inventory.ts:240`
(`case_id` text → FK `vt_cases.id`, `onDelete: set null` — closing/deleting a case never destroys the
dispense audit trail). Read-path partial index `idx_vt_dispense_events_clinic_case` on
`(clinicId, caseId) WHERE caseId IS NOT NULL` (`inventory.ts:256-259`). Barrel export added at
`server/schema/index.ts:3`.

Independently verified: `caseId` is genuinely nullable (no `.notNull()`), confirming this is additive, not
a breaking schema change.

## 2. Server binding mechanism

DB-free reader/writer port, following the existing `readiness-forecast-engine.ts` dependency-injection
precedent, in `server/lib/case-spine.ts`:
- `interface CaseSpineReader` — `getCase(clinicId, caseId)`, `getCaseTimeline(clinicId, caseId)`
  (`case-spine.ts:45-48`)
- `interface CaseSpineWriter` — `createCase(input)`, `attachDispenseEvent(clinicId, caseId, dispenseEventId)`
  (`case-spine.ts:51-54`)
- `interface CaseSpineStore extends CaseSpineReader, CaseSpineWriter` (`case-spine.ts:56`)
- Proof function `createCaseAndAttachDispense(store, input)` → `{ case, timeline }`
  (`case-spine.ts:72-88`): creates a case, attaches one dispense event, reads back the clinic-scoped
  timeline. Every method signature takes `clinicId` as its first parameter — no direct DB access at this
  layer.

Real Drizzle adapter (exists, typechecks, **not wired to any route**):
`class DrizzleCaseSpineStore implements CaseSpineStore` in `server/services/case-spine.store.ts` —
every query (`insert`/`update`/`select`) is scoped with `eq(clinicId, clinicId)` inside `and(...)`,
including the dispense-attach write path (prevents cross-clinic attach). Independently re-read in full
and confirmed clinic-scoped end to end.

**`drizzle-kit generate` could not be exercised** in the spike environment: it fails resolving the
pre-existing `.js`-extensioned schema-barrel imports (`Error: Cannot find module './core.js'`, thrown at
`server/schema/index.ts:2` — the pre-existing `core.js` import line, *before* the spike's added
`cases.js` line) — a drizzle-kit@0.28.1 ESM/TS resolution quirk unrelated to the spike itself. The
schema-as-TypeScript compiles cleanly under both tsconfigs (`pnpm typecheck` = 0 errors — independently
re-run and confirmed), which is what the spike set out to prove. **No migration SQL was generated** for
`vt_cases` or the `caseId` column (`migrations/` unchanged, latest file still `177_vt_shift_handover.sql`)
— consistent with a throwaway spike, but Task 1.2 must author the real migration through a working
generate environment or hand-write SQL matching the `migrations/` conventions.

## 3. Client offline mechanism

**Chose: reuse the existing `pendingSync` Dexie table with a new `type` value `"case_attach"`**, rather
than a wholly separate Dexie store. Reasoning:
1. The payload (`caseId`, `dispenseEventId`, `clinicId`) maps cleanly onto the existing
   `endpoint`/`method`/`body` row shape — a separate store buys nothing.
2. It inherits the fully-tested `processQueue` reconcile machinery (retries, circuit-breaker, 409/401/403
   handling, dedup, dead-lettering) at zero new-infrastructure risk.
3. **No Dexie version bump needed.** The `pendingSync` store index string is
   `"++id, type, createdAt, status, clientTimestamp"` (`offline-db.ts:93`) — `type` is indexed but its
   values aren't enumerated in the Dexie schema string, so a new union member is additive with no store
   migration. `dexie` stays pinned at `"3.2.7"` in `package.json` — independently grepped and confirmed
   untouched.

Files:
- `"case_attach"` added to the `PendingSyncType` union, `src/lib/offline-db.ts:37-42`.
- New helper `src/lib/case-attach-offline.ts`: `buildCaseAttachEndpoint(caseId)` →
  `/api/cases/${caseId}/attachments`, `buildCaseAttachBody`, and `queueCaseAttachIfOffline(payload)`
  (offline → `addPendingSync({ type: "case_attach", ... })`; online → returns `{ mode: "online" }` for the
  caller to POST directly).

**What the reconcile test proves** (`tests/case-attach-offline-reconcile.test.ts`, mirroring the existing
OFF-05 pattern in `tests/offline-phase-5-sync-engine-state.test.ts` — `offline-db` mocked, `isOnline`
toggled, `processQueue` driven directly):
- Test 1: while `isOnline() === false`, `queueCaseAttachIfOffline` enqueues exactly one `case_attach` row
  with the correct endpoint/method/body, and nothing hits the wire (`fetch` not called).
- Test 2: after flipping online, `processQueue` reconciles the queued row exactly once — `fetch` called
  once with the right URL/method/body, row transitions `processing → synced` (no loss, no duplication).

Conflict resolution (concurrent attaches to the same case) is explicitly **out of scope** for this spike
— see the seam list below.

## 4. Every seam Task 1.2 must build through

1. **Real migration** — author + commit the `vt_cases` + `dispense_events.case_id` SQL (the generate
   quirk above blocked it in the spike environment; latest migration is `177_vt_shift_handover.sql`).
2. **Attach route** — `POST /api/cases/:caseId/attachments` (+ case CRUD) with auth middleware and
   **`clinicId` enforcement** on both the case and the dispense event before setting `case_id`. Nothing
   exists yet; the client helper already points at this path.
3. **Offline-mutation-registry allow-producer entry** — `src/lib/offline-mutation-registry.ts` gates the
   real `addPendingSync` call via `assertPendingSyncEnqueueAllowed`; `case_attach` is **not** registered
   there yet, so the live enqueue path currently throws `UnknownOfflineMutationError`. Task 1.2 must add a
   `case.attach` allow-producer row (pattern + method + path regex + `conflictStrategy`), add
   `case_attach` to `ProducerPendingSyncType`, and satisfy the registry-coverage test that discovers
   producer types from the API source. (Deliberately omitted from the spike to keep blast radius minimal —
   the spike test mocks the enqueue path, same as the existing OFF-05 pattern.)
4. **i18n label** — `src/components/sync-queue-sheet.tsx:38-41` currently reuses the `typeUpdate` label for
   `case_attach` to stay off the parity-enforced i18n surface for the spike. Task 1.2 must add a dedicated
   `typeCaseAttach` key to `locales/en.json` + `locales/he.json` and regenerate types
   (`scripts/i18n/generate-types.ts`).
5. **Conflict resolution** — concurrent attaches / re-attach / attach-after-case-closed semantics. The
   spike does a blind clinic-scoped update with `onDelete: set null`; Task 1.2 needs a real
   idempotency/version story — likely append-only, matching the existing `scan` event model rather than a
   mutable single-row update.
6. **The other 5 event paths.** Custody scan, Code Blue session, task, damage report, RFID each need the
   same additive nullable `caseId` + attach-through-port wiring the spike proved for dispense.
   ⚠️ **Code Blue is a frozen surface** — its `case_id` binding must be additive-nullable only and must
   never alter emergency mutation semantics (online-only mutations, server-confirmed end, no offline
   queueing). Independently confirmed the spike itself never touches
   `server/lib/code-blue-one-tap.ts` or any `server/routes/code-blue*` file.
7. **Timeline projection.** The spike's `CaseTimelineEntry` only carries `kind: "dispense"`. Task 1.2 must
   widen it to a discriminated union across all seven event kinds and decide the real read source
   (per-table union query vs. a materialized projection).
8. **Realtime.** If the case timeline should update live, route through the existing SSE/outbox transport
   **additively** — do not add a parallel realtime path. Independently confirmed the spike touches neither
   `server/lib/realtime-outbox.ts`, `server/lib/event-publisher.ts`, nor `server/schema/ops.ts`
   (the `vt_event_outbox` table).

## 5. Verification evidence

**Self-reported by the implementer, then independently re-verified from a fresh context against the
actual worktree** (not taken on trust — a separate reviewer agent re-ran every command):

- `pnpm typecheck` (both tsconfigs) — **0 errors.** Confirmed independently: clean exit, no errors
  printed.
- `pnpm test -- tests/case-spine-spike.test.ts tests/case-attach-offline-reconcile.test.ts` — **Test
  Files 2 passed (2), Tests 5 passed (5).** Confirmed independently — exact match.
- `git diff --stat <base>..HEAD` — base commit `a428cba42` (confirmed via `git log`/`git branch -vv`):
  ```
  server/schema/index.ts              |  1 +
  server/schema/inventory.ts          | 12 ++++++++++++
  src/components/sync-queue-sheet.tsx |  4 ++++
  src/lib/offline-db.ts               |  8 +++++++-
  ```
  plus 6 new files: `server/schema/cases.ts`, `server/lib/case-spine.ts`,
  `server/services/case-spine.store.ts`, `src/lib/case-attach-offline.ts`,
  `tests/case-spine-spike.test.ts`, `tests/case-attach-offline-reconcile.test.ts`. Confirmed
  independently — exact match on files and line counts. (The spike work is now a single committed commit
  on its branch, so `git status --porcelain` on that branch is clean — no outstanding untracked files.)
- **Frozen-surface check** — grepped every changed/new file for `realtime-outbox`, `event-publisher`,
  `vt_event_outbox`, `code-blue`/`code_blue`/`codeBlue`, `vt_appointments`, `appointmentsPage`: **zero
  hits.** `git diff --stat` scoped to the frozen-surface file list (`realtime-outbox.ts`,
  `event-publisher.ts`, `schema/ops.ts`, `routes/code-blue*`, `code-blue-one-tap.ts`, `package.json`):
  **empty** — none touched, `dexie` version line untouched. Confirmed independently.
- **Multi-tenancy check** — every read/write path in `cases.ts`, `case-spine.ts`, and
  `case-spine.store.ts` is `clinicId`-scoped. Confirmed independently by reading all three files in full.
- **Schema-boundary check** — `vt_cases` carries no diagnosis/prescription/lab/imaging/owner-PII columns;
  `caseId` on `vt_dispense_events` is genuinely nullable. Confirmed independently.

## 6. Spike branch (unmerged — do not merge)

`worktree-agent-ad05bf556984d8f59`, commit `961378e55`
(`spike(2.0): Case Spine physical×clinical join + offline reconcile (task 0.2)`), branched from
`a428cba42`. Built in an isolated git worktree at
`/Users/dan/vettrack/.claude/worktrees/agent-ad05bf556984d8f59`. Not pushed, no PR opened. This branch is
a learning artifact only — Task 1.2 reads this findings document, it does not build on top of the spike
branch's commits.
