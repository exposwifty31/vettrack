# Docking First-Class — Consolidated Review Findings

Branch: `feat/docking-first-class` (isolated worktree). Plan: the docking-as-first-class implementation plan.
Execution: subagent-driven development with TDD, per-task review + per-phase review gate. This doc is the running record of every review finding and its resolution across all phases (P1–P4).

---

## P1 — Ownership

**Scope:** dock category+capacity, `equipment.home_room_id`, partial unique index, pure derivation service, dock 409 route, `/api/docking` (home-assign + bulk + reconciliation), client wiring, two Manager pages. 24 files, +1742/−20 (base `529006d1b` → `152c9a2e0`, pre-fixes). **Zero custody/return behavior change.**

**Phase-gate status:** i18n parity ✓ · `architecture:gates` all-pass (tsc frontend+server clean; 4 depcruise warnings pre-existing in rooms/inventory tablet features, not docking; madge cycles = baseline) · full suite 4810/4812 (the single failing file `tests/stage-6-equipment-detail-token-consistency.test.js` is **pre-existing** — the P1 diff manifest touches none of stage-6/equipment-detail/shift-gating).

### Per-task review outcomes

| Task | Reviewer | Verdict | Findings → resolution |
|---|---|---|---|
| T1.1 schema/migration | subagent (sonnet) | Spec ✅ / Approved | Implementer self-caught: test wrongly placed under excluded `tests/migrations/**` → **relocated** to top-level `tests/` so `pnpm test` runs it (commit `4225638`). |
| T1.2 derivation | controller | Spec ✅ / Approved | `roomExpected` untested (trivial; exercised by P3) — Minor, logged. |
| T1.3 dock route/409 | subagent (sonnet) | Spec ✅ / 1 Important | 409 message ambiguous across the name vs room/category unique constraints → **fixed**: added `getPostgresConstraintName()` in `pg-result.ts`, branch name→`duplicateName` / station→`duplicateStation`, rethrow unknown (→500); + duplicate-name test (commit `84d29fe52`). |
| T1.4 /api/docking | subagent (sonnet) | Spec ✅ / Approved (0 issues) | Tenancy verified line-by-line on all 5 queries; lock-test `routes-registration-contract-slice7` legitimately updated for the new mount. |
| T1.5 client wiring | controller | Spec ✅ / Approved | Binds to reviewed server shapes; both tsc configs clean. |
| T1.6 AdminDocksPage | controller | Spec ✅ / Approved | New `adminDocks` i18n keys verified to **resolve at runtime** via `tsx` eval (hand-built `t` gotcha cleared). |
| T1.7 AdminHomeAssignmentPage | controller + phase | Spec ✅ / Approved | `WebOnlyGuard` omitted (matches real AdminDocksPage) — phase review **adjudicated: not an overflow risk** (single-column `max-w-3xl`, degrades cleanly). |

### Phase review (opus) — APPROVE WITH NITS · 0 Critical · 1 Important · 6 Minor

**Adjudications (confirmed sound):** multi-tenancy clean across both route files; migration additive-safe (nullable adds, no rewrite); custody states + frozen surfaces untouched; 409 disambiguation correct (`err.constraint` = index name, incl. partial); reconciliation = 2 queries + in-memory derivation, no N+1; `GET /reconciliation` `requireAuth` (not admin) acceptable (within-clinic read already available via `/api/equipment`); i18n `adminHomeAssignment` hand-wired at `i18n.ts:1113`, `errors` wired wholesale — no undefined-at-runtime trap.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| **I1** | Important | One-tap "Assign home" on the Unassigned bucket sends only `homeRoomId`; a **category-less** item stays unassigned yet fires a success toast (false-positive feedback). | **FIXED** (p1-fixes): one-tap disabled+hinted for `assetTypeId===null` rows; keeps working for home-room-only-missing rows; test asserts both. |
| **M1** | Minor | `GET /docks` never joins `rooms`/returns `roomName`, but `AdminDocksPage` renders it; the page test only passes because its mock injects `roomName` (tautological). Pre-existing gap; P1 added the parallel `assetTypeName` join. | **FIXED** (p1-fixes): added `rooms` leftJoin selecting `roomName`; integration test asserts the real endpoint returns it. |
| **M4** | Minor | `bulkAssignHomeSchema.ids` unbounded; bulk audit metadata stores the full `ids` array. | **FIXED** (p1-fixes): `.max(500)` cap; audit logs `count` only (dropped `ids`). |
| **M2** | Minor | Partial unique index doesn't enforce one-per-(room,category) when `room_id IS NULL` (SQL NULL-distinct semantics). | **DEFERRED — benign.** Room-less docks are inert in the ownership model (`resolveHomeDock` needs non-null `homeRoomId`→`dock.roomId`; `dockExpectedFill`→0 for null room). Revisit with `NULLS NOT DISTINCT` (PG15+) when `asset_type_id` is tightened to NOT NULL (design §10 deferred). |
| **M3** | Minor | `createDock`/home-assign don't verify referenced `roomId`/`assetTypeId`/`homeRoomId` belong to the caller's clinic (FKs aren't clinic-scoped). Admin-gated; needs a known foreign UUID; reconciliation only reads this clinic. | **DEFERRED — consistency debt.** Matches pre-existing unvalidated `roomId` behavior; a same-clinic existence check is a broader cross-route hardening, tracked as a follow-up (not a P1 regression). |
| **M5** | Minor | `AdminDocksPage` carries hardcoded English (`"Add Dock"`, `title="Docks"`, `"No room"`, `toast.success("Dock created")`, new sr-only `Capacity` label). Not Hebrew, so the source guard doesn't catch it; violates the no-hardcoded-copy convention. | **DEFERRED — pre-existing.** All but the sr-only label predate P1; AdminHomeAssignmentPage is fully localized. Tracked to localize AdminDocksPage wholesale in a follow-up. |
| **M6** | Minor | `idx_vt_equipment_clinic_home_room` is a non-`CONCURRENTLY` `CREATE INDEX` (SHARE lock blocks `vt_equipment` writes for the build). | **DEFERRED — unavoidable.** `CONCURRENTLY` is illegal inside the migration transaction; low risk at per-clinic volumes. Noted for awareness. |

**Deferred-minors tracker (follow-ups, not P1-blocking):** M2, M3, M5, M6 above. M3 (cross-clinic referenced-id validation) is the most substantive — recommend a shared `assertBelongsToClinic(ids)` helper applied across dock/home/room-referencing writes in a later hardening pass.

**P1 verdict:** APPROVED after the I1/M1/M4 fixes (commit `85f0fffd8`). Deferred minors are documented and non-blocking. Live RTL/visual screenshot **deferred** (Clerk-mode shared env makes automated browser auth fragile; behavior covered by happy-dom component tests + real-DB integration tests; RTL inherited from shipped AdminDocksPage shadcn patterns) — to be captured in a dev-bypass/device-audit env.

---

## P2 — Unified return + anchors + contradictions

**Scope:** append-only `vt_equipment_anchors` stream (D-13 sticky-until-contradicted); dock-return writes a `return_toggle` anchor in-transaction; unified return dialog (home-station toggle) on web + native; checkout/RFID-elsewhere contradiction wiring; evidence-graph `dock_station` location precedence; citizen-anchor + not-found-here endpoints with native scan/detail UI. Range `bc62b51e7..d67d102c9` (10 commits, 40 files, +3332/-170).

### Per-task notes
- **T2.3-mobile / T2.5-mobile:** the docking clinical UX lives on the NATIVE surfaces (`EquipmentActions`, `qr-scanner` result sheet) per the owner directive ("web is irrelevant"). Web `equipment-detail.tsx` wiring kept but is not the shipping surface.
- **Documented deviation (T2.5 action split):** the plan grouped both human-anchor actions "in the scan flow." Split by semantics — **citizen-anchor → scan result sheet** (a successful scan proves physical presence), **not-found-here → native detail** (reached via search; you cannot scan an item you cannot find). Phase reviewer judged the split **sound**; gating (`!isCheckedOut && homeRoomId`) correct on both.
- **Regression caught by the phase-gate full suite (not per-task runs):** `stage-6-equipment-detail-token-consistency.test.js` is a source-TEXT guard asserting `EquipmentActions.tsx` contains `ReturnPlugDialog`; T2.3-mobile's sanctioned swap to `UnifiedReturnDialog` broke it. **FIXED** `d67d102c9` — guard re-pointed at `UnifiedReturnDialog`; behavioral invariant (`api.equipment.return` still wired) unchanged and still asserted.

### Phase review (opus, code-reviewer) — APPROVE-WITH-NITS · 0 Critical · 1 Important · 5 Minor

**Adjudications (verified sound against live source):** multi-tenancy clean (anchor service, both docking endpoints, evidence loader, RFID dock lookup all clinic-scoped; integration test locks it); fire-and-forget invalidation genuinely non-blocking (checkout uses `void …catch` on the pool not `tx`; RFID dispatches post-commit) — a thrown anchor write cannot roll back or slow the primary mutation; D-13 contradiction-only honored (`nextAnchorState` never invalidates on time; DB CHECK bounds the four reasons); migration 165 additive/idempotent (`IF NOT EXISTS`, empty new table, indexes include `clinic_id`); audit union closed (`equipment_anchor_created`/`_contradicted` added; no `logAudit` awaited in-tx); evidence-graph precedence exactly `checkout › rfid_room › dock_station › room › free-text`, invalidated anchors never load; frozen surfaces untouched (SSE/outbox, offline-emergency block, telemetry enums, Strategy A); i18n hand-wiring verified (both affected namespaces spread; no undefined-at-runtime); no regression to waitlist promotion / bundle-readiness gate / version-guard rollback (a failed dock-return writes no anchor — integration-tested).

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| **I-1** | Important | `UnifiedReturnDialog` defaults the home-station toggle ON for a homed item; the checked path calls the online-only `dockReturn`. A homed item returned **offline** thus defaults into a path that can't complete offline — confirm either disabled behind a hint pointing at a "Readiness tab" that doesn't exist on native, or fires and fails. Regresses the offline-first return path; homed-offline case was untested. | **FIXED** (p2-review-fix, commit `0483954b8`): dock-return made connectivity-aware — `effectiveDockOn = dockToggleOn && hasHomeRoom && isOnline`; offline → falls back to the offline-capable plain return (`api.equipment.return`); toggle disabled offline with a correct offline hint; `stationUnresolvedHint` reworded surface-neutral. New test: homed + offline routes to `onConfirmReturn`, not `dockReturn`. |
| **M-3** | Minor | `not-found-here` performs no equipment existence/clinic check before invalidate + audit (writes a `_contradicted` audit row for a possibly-foreign/nonexistent id). Clinic-scoping already blocks cross-tenant effect; citizen-anchor already 404s. | **FIXED** (p2-review-fix, commit `0483954b8`): mirror citizen-anchor's 404 existence check; integration test covers nonexistent id → 404, no audit. |
| **M-4** | Minor | `notFoundMut.onError` on native detail renders `returnFailed("")` → "Return failed" for a failed not-found report. | **FIXED** (p2-review-fix, commit `0483954b8`): dedicated `equipmentDetail.toast.notFoundFailed` key (both locales, hand-wired in i18n.ts); test asserts it. |
| **M-1** | Minor | Checkout anchor invalidation is dispatched mid-transaction (before the checkout commits). Reviewer: "by-design-acceptable" — satisfies must-not-block; the reverse inconsistency (anchor gone but checkout rolled back) is rare (version-conflict throw is above this line, so the equipment update already succeeded) and self-healing. | **DEFERRED — by-design-acceptable.** Moving it post-commit (symmetric with `rfid-ingest.ts`) is a cosmetic hardening; deferred to avoid restructuring the checkout tx in a review-fix pass. |
| **M-2** | Minor | No unique partial index enforcing single-open-anchor; `createAnchor`'s supersede-`UPDATE`-then-`INSERT` isn't atomic against a concurrent same-item create → a race could leave two open rows. | **DEFERRED — low value / risk-trading.** Both `createAnchor` supersede and `invalidateCurrentAnchor` operate on ALL open rows (`WHERE invalidated_at IS NULL`, not `LIMIT 1`), so any stray open anchor is invalidated by the next contradiction/supersede; reads use `ORDER BY asserted_at DESC LIMIT 1` (never wrong meanwhile). A unique partial index would instead make `createAnchor` THROW under concurrency (rolling back an in-tx dock-return) — a new failure mode needing its own concurrency tests. Revisit as a dedicated hardening if warranted. |
| **M-5** | Minor | `return_toggle` anchor stores `eq_row.roomId` (assigned room), not the resolved dock's room. Informational only — location resolution uses `dockId`/`dockName`; RFID-elsewhere derives the station room from the dock first. | **DEFERRED — informational.** Cosmetic consistency with the citizen path (which uses `homeDock.roomId`); no behavioral effect. Would need the dock row's `roomId` at the write site. |

**Informational (verified intended, no action):** desktop `returned`-item action reorg (dock-return moved to Readiness tab) is documented + in scope; RFID per-candidate fan-out matches the pre-existing `deliverSemiDockPush` fire-and-forget pattern and short-circuits at `getCurrentAnchor → null`.

**Deferred-minors tracker (follow-ups, not P2-blocking):** M-1 (post-commit checkout invalidation symmetry), M-2 (single-open-anchor DB invariant + concurrency tests), M-5 (dock-room on return_toggle anchor). Carry into the final whole-branch review triage.

**P2 verdict:** APPROVE-WITH-NITS. I-1 + M-3 + M-4 fixed (commit `0483954b8`); M-1/M-2/M-5 deferred with justification. Live RTL/device visual pass for the native scan/detail docking actions deferred to a dev-bypass/device-audit env (same rationale as P1).

## P3 — Room Sweep + reconciliation

_pending_

## P4 — Charging integration

_pending_

## Final whole-branch review

_pending_
