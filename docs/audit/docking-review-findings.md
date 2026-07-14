# Docking First-Class — Consolidated Review Findings

Branch: `feat/docking-first-class` (isolated worktree). Plan: `/Users/dan/.claude/plans/greedy-imagining-blossom.md`.
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
_pending (phase not started)_

## P3 — Room Sweep + reconciliation
_pending_

## P4 — Charging integration
_pending_

## Final whole-branch review
_pending_
