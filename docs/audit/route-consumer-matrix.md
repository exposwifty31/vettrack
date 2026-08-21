# Route consumer matrix — 311 routes, 43 with no consumer

**Extracted 2026-08-21** from `AUDIT-repo-b.md`, a 479 KB untracked scratch report that
the repo-cleanup lane deletes. The report was the only copy of this matrix; the triage it
feeds (delete / defer-with-a-named-destination / won't-do, one verdict per route) outlives
it, so the matrix is committed here first and the source is deleted afterwards, in that
order.

**This document is deliberately ungoverned** — `verify.config.json` lists 21 `governedDocs`
and the only one under `docs/audit/` is `PROOF_ALIGNMENT_LOG.md`. It is a dated snapshot,
not a live claim: it was measured against `origin/main` @ `3f5fc8a2e` and the RN branch
`feat/w-auth-2-branded-signin`, and it goes stale the moment a route is added. Re-measure
before acting on any single row — do not cite it as current truth.

**What it is for.** Every NO-CONSUMER route is one of three things and the triage must say
which: dead (delete), built-ahead-of-its-caller (name the slice that will consume it **and**
the condition under which it should instead be deleted), or genuinely reached by something
this scan could not see (record how). A route "kept for later" with no gate is how the next
audit finds it again.

---

## ROUTE-MATRIX
Full Express route inventory built from `server/app/routes.ts` + all 61 files under `server/routes/` + `server/integrations/routes/ops.routes.ts` + `server/integrations/webhooks/inbound.router.ts` + direct registrations in `server/index.ts` (health/version/well-known/sw.js/manifest/rfid/webhooks), read from `origin/main` @ 3f5fc8a2e via a throwaway worktree (this checkout's own branch is `claude/recursing-jemison-0da181`, an ancestor of `origin/main`, so `origin/main` is authoritative).
Consumer evidence: mechanical extraction of every `/api/*`-shaped string/template literal from the ENTIRE web `src/` (915 occurrences, 498 files) and the ENTIRE RN `src/` — both the checked-out feature branch `feat/w-auth-2-branded-signin` (409 occurrences, 381 files, confirmed 10 commits ahead / 0 behind `origin/main` so it is a strict superset) and RN's own `origin/main` (also 409 — the extra commits did not add new literal paths) — normalized to segment shapes (`:id` / `${x}` -> wildcard) and matched against each server route's shape. Every unmatched route below was then hand-verified with a second and third search strategy (constant/function names, doc comments, `docs/`, `scripts/`, `tests/`) before being called NO-CONSUMER — see the Notes column / FINDINGS table.
**311** method+path pairs (raw registrations incl. the `display.ts` double-mount `/api/display` + `/api/equipment-board` and the `health.ts` triple-mount `/api/health` + `/api/health/ready` + bare `/health`).
| Verdict | Count |
|---|---|
| consumed (web+RN) | 122 |
| consumed (web) | 115 |
| NO-CONSUMER | 43 |
| NO-CONSUMER (documented dev-only) | 7 |
| SUSPECTED NO-CONSUMER | 6 |
| TEST-ONLY | 6 |
| consumed (RN) | 4 |
| operator-surface | 3 |
| contract-surface | 2 |
| NO-CONSUMER (documented stub) | 1 |
| NO-CONSUMER (staged) | 1 |
| consumed (external device sender) | 1 |

### Full matrix

`web`/`RN` columns: first evidence file:line if consumed, `-` if not, `test-only` if only test files reference it. `other` = non-web/RN consumer (rfid-controller, external webhook, ops docs/scripts, test harness gate). Full note text for every non-`consumed` row is in the **Notes** subsection below the table (keyed by method+path) to keep this table scannable.

| Method | Path | web | RN | other | Verdict |
|---|---|---|---|---|---|
| GET | `/api/action-proposals` | features/autopilot/proposal-queue-keys.ts:10 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/action-proposals/:id/approve` | lib/api.ts:1499 | test-only | - | consumed (web) |
| POST | `/api/action-proposals/:id/edit` | lib/api.ts:1504 | test-only | - | consumed (web) |
| POST | `/api/action-proposals/:id/reject` | lib/api.ts:1509 | test-only | - | consumed (web) |
| GET | `/api/activity` | features/today/surfaces/ops/use-ops-home.ts:35 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/activity/my-scan-count` | lib/api.ts:462 | lib/api/home.ts:124 | - | consumed (web+RN) |
| GET | `/api/admin/clinic-join-code` | lib/api.ts:279 | - | - | consumed (web) |
| POST | `/api/admin/clinic-join-code/rotate` | lib/api.ts:284 | - | - | consumed (web) |
| GET | `/api/admin/cursor-bug-fixer/agents/:agentId` | lib/api.ts:774 | - | - | consumed (web) |
| GET | `/api/admin/cursor-bug-fixer/agents/:agentId/runs/:runId` | lib/api.ts:778 | - | - | consumed (web) |
| GET | `/api/admin/cursor-bug-fixer/config` | lib/api.ts:766 | - | - | consumed (web) |
| POST | `/api/admin/cursor-bug-fixer/dispatch` | - | - | none found | NO-CONSUMER |
| POST | `/api/admin/cursor-bug-fixer/support-tickets/:id/dispatch` | lib/api.ts:769 | - | - | consumed (web) |
| GET | `/api/admin/equipment/readiness-rules` | lib/api.ts:973 | - | - | consumed (web) |
| PATCH | `/api/admin/equipment/readiness-rules` | lib/api.ts:973 | - | - | consumed (web) |
| GET | `/api/admin/notifications` | lib/api.ts:965 | - | - | consumed (web) |
| GET | `/api/admin/outbox-health` | lib/api.ts:997 | - | - | consumed (web) |
| GET | `/api/admin/outbox/dlq` | lib/api.ts:1018 | - | - | consumed (web) |
| POST | `/api/admin/outbox/dlq/drop` | lib/api.ts:1036 | - | - | consumed (web) |
| POST | `/api/admin/outbox/dlq/retry` | lib/api.ts:1025 | - | - | consumed (web) |
| POST | `/api/admin/rfid-provisioning/ack` | - | - | none found | SUSPECTED NO-CONSUMER |
| PUT | `/api/admin/rfid-provisioning/ingest` | lib/api.ts:949 | - | - | consumed (web) |
| POST | `/api/admin/rfid-provisioning/rollback` | - | - | none found | SUSPECTED NO-CONSUMER |
| POST | `/api/admin/rfid-provisioning/rotate` | lib/api.ts:943 | - | - | consumed (web) |
| GET | `/api/admin/rfid-readers` | lib/api.ts:913 | - | - | consumed (web) |
| POST | `/api/admin/rfid-readers` | lib/api.ts:913 | - | - | consumed (web) |
| PATCH | `/api/admin/rfid-readers/:id` | lib/api.ts:919 | - | - | consumed (web) |
| POST | `/api/admin/rfid-readers/:id/deactivate` | lib/api.ts:937 | - | - | consumed (web) |
| GET | `/api/admin/rfid-readers/managed` | lib/api.ts:919 | - | - | consumed (web) |
| POST | `/api/admin/task-ownership/backfill` | - | - | none found | NO-CONSUMER |
| GET | `/api/admin/task-ownership/backfill/:jobId` | - | - | none found | NO-CONSUMER |
| GET | `/api/admin/task-ownership/queue` | - | - | none found | NO-CONSUMER |
| POST | `/api/admin/task-ownership/queue/:id/confirm` | - | - | none found | NO-CONSUMER |
| POST | `/api/admin/task-ownership/queue/:id/reject` | - | - | none found | NO-CONSUMER |
| POST | `/api/admin/task-ownership/queue/:id/skip` | - | - | none found | NO-CONSUMER |
| GET | `/api/admin/task-ownership/queue/count` | - | - | none found | NO-CONSUMER |
| GET | `/api/admin/webhooks` | lib/api.ts:958 | - | - | consumed (web) |
| GET | `/api/alert-acks` | native/NativeHeader.tsx:76 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/alert-acks` | native/NativeHeader.tsx:76 | lib/api.ts:269 | - | consumed (web+RN) |
| PATCH | `/api/alert-acks/:id/resolve` | - | lib/api/alert-acks.ts:80 | - | consumed (RN) |
| GET | `/api/analytics` | lib/api.ts:471 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/analytics/billing` | lib/api.ts:478 | - | - | consumed (web) |
| GET | `/api/analytics/readiness-forecast` | lib/api.ts:472 | - | - | consumed (web) |
| GET | `/api/analytics/shift-completion` | lib/api.ts:478 | - | - | consumed (web) |
| GET | `/api/appointments` | lib/api.ts:703 | types/tasks.ts:5 | - | consumed (web+RN) |
| POST | `/api/appointments` | lib/api.ts:703 | types/tasks.ts:5 | - | consumed (web+RN) |
| DELETE | `/api/appointments/:id` | lib/api.ts:712 | lib/api/tasks.ts:199 | - | consumed (web+RN) |
| PATCH | `/api/appointments/:id` | lib/api.ts:712 | lib/api/tasks.ts:199 | - | consumed (web+RN) |
| GET | `/api/appointments/meta` | lib/api.ts:712 | lib/api/tasks.ts:199 | - | consumed (web+RN) |
| GET | `/api/asset-types` | components/dock-return-nfc.tsx:55 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/asset-types` | components/dock-return-nfc.tsx:55 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/asset-types/:assetTypeId/conditions` | lib/api.ts:1319 | - | - | consumed (web) |
| POST | `/api/asset-types/:assetTypeId/conditions` | lib/api.ts:1319 | - | - | consumed (web) |
| GET | `/api/audit-logs` | lib/api.ts:790 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/auth/join-clinic` | lib/api.ts:258 | - | - | consumed (web) |
| POST | `/api/clinical-check-in/check-in` | lib/api.ts:558 | lib/api/clinical-check-in.ts:128 | - | consumed (web+RN) |
| POST | `/api/clinical-check-in/check-ins/:id/admin-force-close` | - | - | none found | NO-CONSUMER |
| POST | `/api/clinical-check-in/check-out` | lib/api.ts:567 | lib/api/clinical-check-in.ts:144 | - | consumed (web+RN) |
| GET | `/api/clinical-check-in/me/active` | features/shift-gate/useDoctorGateState.ts:34 | lib/api/clinical-check-in.ts:124 | - | consumed (web+RN) |
| GET | `/api/clinical-check-in/me/operational-roles` | - | - | none found | NO-CONSUMER |
| POST | `/api/clinical-check-in/switch` | lib/api.ts:563 | lib/api/clinical-check-in.ts:136 | - | consumed (web+RN) |
| GET | `/api/code-blue/events` | lib/api.ts:1190 | - | - | consumed (web) |
| POST | `/api/code-blue/events` | lib/api.ts:1190 | - | - | consumed (web) |
| PATCH | `/api/code-blue/events/:id` | lib/api.ts:1195 | - | - | consumed (web) |
| GET | `/api/code-blue/history` | lib/api.ts:1200 | test-only | - | consumed (web) |
| POST | `/api/code-blue/one-tap` | lib/api.ts:1184 | lib/api/code-blue.ts:106 | - | consumed (web+RN) |
| GET | `/api/code-blue/reconciliation` | - | - | none found | NO-CONSUMER |
| POST | `/api/code-blue/sessions` | lib/api.ts:1150 | lib/api/code-blue.ts:129 | - | consumed (web+RN) |
| GET | `/api/code-blue/sessions/:id/dispenses` | - | - | none found | NO-CONSUMER |
| PATCH | `/api/code-blue/sessions/:id/end` | lib/api.ts:1155 | lib/api/code-blue.ts:143 | - | consumed (web+RN) |
| POST | `/api/code-blue/sessions/:id/logs` | lib/api.ts:1169 | lib/api/code-blue.ts:136 | - | consumed (web+RN) |
| POST | `/api/code-blue/sessions/:id/manual-billing` | - | - | none found | NO-CONSUMER |
| PATCH | `/api/code-blue/sessions/:id/presence` | lib/api.ts:1174 | lib/api/code-blue.ts:150 | - | consumed (web+RN) |
| PATCH | `/api/code-blue/sessions/:id/reconcile` | - | - | none found | NO-CONSUMER |
| GET | `/api/code-blue/sessions/active` | hooks/useCodeBlueSession.ts:57 | lib/api/code-blue.ts:87 | - | consumed (web+RN) |
| GET | `/api/containers` | lib/api.ts:790 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/containers` | lib/api.ts:790 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/containers/:id/blind-audit` | lib/api.ts:856 | - | - | consumed (web) |
| POST | `/api/containers/:id/dispense` | lib/api.ts:345 | lib/api/containers.ts:155 | - | consumed (web+RN) |
| POST | `/api/containers/:id/restock` | lib/api.ts:850 | - | - | consumed (web) |
| POST | `/api/containers/bootstrap-defaults` | lib/api.ts:834 | - | - | consumed (web) |
| PATCH | `/api/containers/emergency/:eventId/complete` | lib/api.ts:898 | lib/api/containers.ts:167 | - | consumed (web+RN) |
| POST | `/api/crash-cart/checks` | pages/crash-cart.tsx:84 | - | - | consumed (web) |
| GET | `/api/crash-cart/checks/latest` | pages/crash-cart.tsx:71 | - | - | consumed (web) |
| GET | `/api/crash-cart/items` | components/crash-cart-admin-sheet.tsx:52 | - | - | consumed (web) |
| POST | `/api/crash-cart/items` | components/crash-cart-admin-sheet.tsx:52 | - | - | consumed (web) |
| DELETE | `/api/crash-cart/items/:id` | lib/api.ts:743 | - | - | consumed (web) |
| PATCH | `/api/crash-cart/items/:id` | lib/api.ts:743 | - | - | consumed (web) |
| POST | `/api/dispense/:id/confirm` | - | - | none found | NO-CONSUMER |
| POST | `/api/dispense/draft` | - | - | none found | NO-CONSUMER |
| POST | `/api/dispense/emergency` | - | - | none found | NO-CONSUMER |
| GET | `/api/display/devices` | lib/api.ts:1227 | - | - | consumed (web) |
| DELETE | `/api/display/devices/:id` | lib/api.ts:1229 | - | - | consumed (web) |
| PATCH | `/api/display/devices/:id` | lib/api.ts:1229 | - | - | consumed (web) |
| POST | `/api/display/devices/:id/revoke` | lib/api.ts:1234 | - | - | consumed (web) |
| POST | `/api/display/heartbeat` | lib/api.ts:1217 | - | - | consumed (web) |
| POST | `/api/display/pair/claim` | lib/api.ts:397 | - | - | consumed (web) |
| POST | `/api/display/pair/issue` | lib/api.ts:1224 | - | - | consumed (web) |
| GET | `/api/display/snapshot` | features/shift-gate/DoctorShiftStatus.tsx:61 | test-only | - | consumed (web) |
| GET | `/api/docking/coordinator` | features/equipment/sweep/CoordinatorSweepState.tsx:53 | - | - | consumed (web) |
| POST | `/api/docking/coordinator` | features/equipment/sweep/CoordinatorSweepState.tsx:53 | - | - | consumed (web) |
| POST | `/api/docking/equipment/:id/citizen-anchor` | lib/api.ts:1376 | - | - | consumed (web) |
| PATCH | `/api/docking/equipment/:id/home` | lib/api.ts:1370 | - | - | consumed (web) |
| POST | `/api/docking/equipment/:id/not-found-here` | lib/api.ts:1378 | lib/api/docking.ts:144 | - | consumed (web+RN) |
| POST | `/api/docking/equipment/home/bulk` | lib/api.ts:1372 | - | - | consumed (web) |
| GET | `/api/docking/reconciliation` | features/equipment/sweep/RoomSweep.tsx:116 | - | - | consumed (web) |
| GET | `/api/docking/rooms/:roomId/sweep` | lib/api.ts:1380 | lib/api/docking.ts:116 | - | consumed (web+RN) |
| POST | `/api/docking/rooms/:roomId/sweep` | lib/api.ts:1380 | lib/api/docking.ts:116 | - | consumed (web+RN) |
| GET | `/api/docks` | components/equipment/UnifiedReturnDialog.tsx:103 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/docks` | components/equipment/UnifiedReturnDialog.tsx:103 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/equipment` | native/NativeHeader.tsx:68 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/equipment` | native/NativeHeader.tsx:68 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/equipment-board/devices` | - | - | none found | NO-CONSUMER |
| DELETE | `/api/equipment-board/devices/:id` | - | - | none found | NO-CONSUMER |
| PATCH | `/api/equipment-board/devices/:id` | - | - | none found | NO-CONSUMER |
| POST | `/api/equipment-board/devices/:id/revoke` | - | - | none found | NO-CONSUMER |
| POST | `/api/equipment-board/heartbeat` | - | - | none found | NO-CONSUMER |
| POST | `/api/equipment-board/pair/claim` | - | - | none found | NO-CONSUMER |
| POST | `/api/equipment-board/pair/issue` | - | - | none found | NO-CONSUMER |
| GET | `/api/equipment-board/snapshot` | - | - | none found | NO-CONSUMER |
| GET | `/api/equipment/:equipmentId/condition-states` | lib/api.ts:1335 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| GET | `/api/equipment/:equipmentId/deployability` | lib/api.ts:1333 | lib/api.ts:334 | - | consumed (web+RN) |
| POST | `/api/equipment/:equipmentId/dock-return` | lib/api.ts:1345 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| DELETE | `/api/equipment/:equipmentId/procedure-bind` | - | lib/api/docking.ts:6 | - | consumed (RN) |
| POST | `/api/equipment/:equipmentId/procedure-bind` | - | lib/api/docking.ts:6 | - | consumed (RN) |
| POST | `/api/equipment/:equipmentId/stage` | lib/api.ts:1355 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| DELETE | `/api/equipment/:equipmentId/stage/:claimId` | lib/api.ts:1357 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| GET | `/api/equipment/:equipmentId/staging-queue` | lib/api.ts:1359 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| DELETE | `/api/equipment/:id` | features/today/surfaces/floor/use-floor-home.ts:24 | screens/MyEquipmentScreen.tsx:6 | - | consumed (web+RN) |
| GET | `/api/equipment/:id` | features/today/surfaces/floor/use-floor-home.ts:24 | screens/MyEquipmentScreen.tsx:6 | - | consumed (web+RN) |
| PATCH | `/api/equipment/:id` | features/today/surfaces/floor/use-floor-home.ts:24 | screens/MyEquipmentScreen.tsx:6 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/checkout` | lib/api/equipment.ts:469 | lib/api.ts:372 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/confirm-in-room` | lib/api/equipment.ts:281 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/copilot/explain` | lib/api/equipment.ts:601 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/damage` | lib/api/equipment.ts:273 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| GET | `/api/equipment/:id/location-inference` | features/equipment/detail/hooks/use-equipment-detail.ts:87 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| GET | `/api/equipment/:id/logs` | features/equipment/detail/EquipmentDetailScreen.tsx:157 | lib/api.ts:322 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/restore` | lib/api/equipment.ts:592 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/return` | lib/api/equipment.ts:494 | lib/api.ts:390 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/revert` | lib/api/equipment.ts:537 | lib/api.ts:290 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/scan` | lib/api/equipment.ts:400 | lib/api.ts:427 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/seen` | lib/api/equipment.ts:435 | lib/api/docking.ts:6 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/toggle` | lib/api/equipment.ts:330 | lib/api.ts:297 | - | consumed (web+RN) |
| GET | `/api/equipment/:id/transfers` | lib/api/equipment.ts:588 | lib/api.ts:328 | - | consumed (web+RN) |
| GET | `/api/equipment/:id/truth` | lib/api/equipment.ts:261 | lib/api.ts:340 | - | consumed (web+RN) |
| DELETE | `/api/equipment/:id/waitlist` | lib/api/equipment.ts:594 | lib/api.ts:348 | - | consumed (web+RN) |
| GET | `/api/equipment/:id/waitlist` | lib/api/equipment.ts:594 | lib/api.ts:348 | - | consumed (web+RN) |
| POST | `/api/equipment/:id/waitlist` | lib/api/equipment.ts:594 | lib/api.ts:348 | - | consumed (web+RN) |
| POST | `/api/equipment/bulk-delete` | features/equipment/detail/EquipmentDetailScreen.tsx:121 | lib/api.ts:317 | - | consumed (web+RN) |
| POST | `/api/equipment/bulk-move` | features/equipment/detail/EquipmentDetailScreen.tsx:121 | lib/api.ts:317 | - | consumed (web+RN) |
| POST | `/api/equipment/bulk-verify-room` | features/equipment/detail/EquipmentDetailScreen.tsx:121 | lib/api.ts:317 | - | consumed (web+RN) |
| GET | `/api/equipment/critical` | features/equipment/detail/EquipmentDetailScreen.tsx:121 | lib/api.ts:317 | - | consumed (web+RN) |
| GET | `/api/equipment/deleted` | features/equipment/detail/EquipmentDetailScreen.tsx:121 | lib/api.ts:317 | - | consumed (web+RN) |
| POST | `/api/equipment/import` | features/equipment/detail/EquipmentDetailScreen.tsx:121 | lib/api.ts:317 | - | consumed (web+RN) |
| GET | `/api/equipment/locate` | features/equipment/LocateSearch.tsx:46 | lib/api.ts:317 | - | consumed (web+RN) |
| GET | `/api/equipment/my` | features/today/surfaces/floor/use-floor-home.ts:24 | screens/MyEquipmentScreen.tsx:6 | - | consumed (web+RN) |
| POST | `/api/equipment/scan` | features/equipment/detail/EquipmentDetailScreen.tsx:121 | lib/api.ts:191 | - | consumed (web+RN) |
| GET | `/api/folders` | lib/api.ts:432 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/folders` | lib/api.ts:432 | lib/api.ts:269 | - | consumed (web+RN) |
| DELETE | `/api/folders/:id` | lib/api.ts:449 | - | - | consumed (web) |
| PATCH | `/api/folders/:id` | lib/api.ts:449 | - | - | consumed (web) |
| GET | `/api/health` | - | - | ops runbook + audit script (docs/release-runbook.md, docs/vettrack-safari-audit.json) | operator-surface |
| GET | `/api/health/data-integrity` | - | - | none found | SUSPECTED NO-CONSUMER |
| GET | `/api/health/live` | - | - | audit script (docs/vettrack-safari-audit.json) | operator-surface |
| GET | `/api/health/ready` | - | - | test (structural) | NO-CONSUMER |
| GET | `/api/health/ready/data-integrity` | - | - | none found | NO-CONSUMER |
| GET | `/api/health/ready/live` | - | - | none found | NO-CONSUMER |
| GET | `/api/health/ready/startup` | - | - | none found | NO-CONSUMER |
| GET | `/api/health/startup` | - | - | ops runbook (docs/release-runbook.md, docs/program-brain/p1-production-baseline-runbook.md) | operator-surface |
| GET | `/api/home/dashboard` | features/today/HomeTabletDashboard.tsx:110 | lib/api/home.ts:110 | - | consumed (web+RN) |
| POST | `/api/integration-webhooks/:adapterId` | - | - | external PMS vendor webhook (inbound) | contract-surface |
| GET | `/api/integrations/adapters` | lib/api.ts:1408 | - | - | consumed (web) |
| GET | `/api/integrations/analytics/product` | - | - | none found | NO-CONSUMER (documented stub) |
| GET | `/api/integrations/billing/mismatch-report` | - | - | none found | NO-CONSUMER (staged) |
| GET | `/api/integrations/configs` | lib/api.ts:1410 | - | - | consumed (web) |
| POST | `/api/integrations/configs` | lib/api.ts:1410 | - | - | consumed (web) |
| DELETE | `/api/integrations/configs/:adapterId` | lib/api.ts:1412 | - | - | consumed (web) |
| GET | `/api/integrations/configs/:adapterId` | lib/api.ts:1412 | - | - | consumed (web) |
| PATCH | `/api/integrations/configs/:adapterId` | lib/api.ts:1412 | - | - | consumed (web) |
| POST | `/api/integrations/configs/:adapterId/credentials` | lib/api.ts:1442 | - | - | consumed (web) |
| GET | `/api/integrations/configs/:adapterId/logs` | - | - | none found | NO-CONSUMER |
| POST | `/api/integrations/configs/:adapterId/promote` | - | - | none found | NO-CONSUMER |
| POST | `/api/integrations/configs/:adapterId/rollback` | - | - | none found | NO-CONSUMER |
| POST | `/api/integrations/configs/:adapterId/sync` | lib/api.ts:1451 | - | - | consumed (web) |
| POST | `/api/integrations/configs/:adapterId/validate` | lib/api.ts:1448 | - | - | consumed (web) |
| GET | `/api/integrations/dashboard` | lib/api.ts:1405 | - | - | consumed (web) |
| GET | `/api/integrations/health` | lib/api.ts:1406 | - | - | consumed (web) |
| PATCH | `/api/integrations/mappings/:id` | lib/api.ts:1425 | - | - | consumed (web) |
| GET | `/api/integrations/mappings/review` | lib/api.ts:1425 | - | - | consumed (web) |
| POST | `/api/integrations/ops/runs/:runId/retry` | lib/api.ts:1463 | - | - | consumed (web) |
| POST | `/api/integrations/ops/sync/window` | - | - | none found | NO-CONSUMER |
| POST | `/api/integrations/ops/webhooks/:id/replay` | lib/api.ts:1468 | - | - | consumed (web) |
| GET | `/api/integrations/runs` | lib/api.ts:1419 | - | - | consumed (web) |
| GET | `/api/inventory-items` | lib/api.ts:790 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/inventory-items` | lib/api.ts:790 | lib/api.ts:269 | - | consumed (web+RN) |
| PATCH | `/api/inventory-items/:id` | lib/api.ts:1110 | - | - | consumed (web) |
| PATCH | `/api/inventory-items/:id/deactivate` | lib/api.ts:1116 | - | - | consumed (web) |
| GET | `/api/inventory-items/:id/detail` | lib/api.ts:1111 | - | - | consumed (web) |
| GET | `/api/inventory-items/:id/prices` | - | - | none found | NO-CONSUMER |
| POST | `/api/inventory-items/:id/prices` | - | - | none found | NO-CONSUMER |
| GET | `/api/inventory-items/low-stock` | lib/api.ts:1110 | - | - | consumed (web) |
| GET | `/api/metrics` | lib/api.ts:748 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/nudges` | features/today/surfaces/HomeNudges.tsx:68 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/operational-metrics/summary` | components/equipment/OperationalMetricsDashboard.tsx:29 | - | - | consumed (web) |
| GET | `/api/platform/capabilities` | components/equipment/AssetCopilotPanel.tsx:23 | - | - | consumed (web) |
| GET | `/api/procurement` | lib/api.ts:790 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/procurement` | lib/api.ts:790 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/procurement/:id` | lib/api.ts:1125 | - | - | consumed (web) |
| PATCH | `/api/procurement/:id/cancel` | lib/api.ts:1134 | - | - | consumed (web) |
| PATCH | `/api/procurement/:id/receive` | lib/api.ts:1133 | - | - | consumed (web) |
| PATCH | `/api/procurement/:id/submit` | lib/api.ts:1131 | - | - | consumed (web) |
| DELETE | `/api/push/subscribe` | hooks/use-push-notifications.tsx:212 | core/ports/push.port.ts:15 | - | consumed (web+RN) |
| PATCH | `/api/push/subscribe` | hooks/use-push-notifications.tsx:212 | core/ports/push.port.ts:15 | - | consumed (web+RN) |
| POST | `/api/push/subscribe` | hooks/use-push-notifications.tsx:212 | core/ports/push.port.ts:15 | - | consumed (web+RN) |
| POST | `/api/push/test` | hooks/use-push-notifications.tsx:311 | - | - | consumed (web) |
| GET | `/api/push/vapid-public-key` | hooks/use-push-notifications.tsx:96 | - | - | consumed (web) |
| GET | `/api/queue/dlq` | - | - | none found | NO-CONSUMER |
| POST | `/api/queue/dlq/:jobId/replay` | - | - | none found | NO-CONSUMER |
| GET | `/api/queue/metrics` | lib/api.ts:1067 | - | - | consumed (web) |
| GET | `/api/realtime` | board/BoardShell.tsx:76 | lib/api.ts:269 | - | consumed (web+RN) |
| GET | `/api/realtime/outbox-head` | board/BoardShell.tsx:76 | test-only | - | consumed (web) |
| GET | `/api/realtime/replay` | board/BoardShell.tsx:76 | - | - | consumed (web) |
| GET | `/api/realtime/stream` | board/BoardShell.tsx:76 | infrastructure/realtime/SseAdapter.ts:65 | - | consumed (web+RN) |
| POST | `/api/realtime/telemetry` | board/BoardShell.tsx:76 | - | - | consumed (web) |
| POST | `/api/restock/cancel` | - | components/inventory/RestockSheet.tsx:5 | - | consumed (RN) |
| POST | `/api/restock/container-items` | features/containers/components/DispenseSheet.tsx:172 | components/inventory/RestockSheet.tsx:5 | - | consumed (web+RN) |
| POST | `/api/restock/finish` | lib/api.ts:1097 | components/inventory/RestockSheet.tsx:5 | - | consumed (web+RN) |
| POST | `/api/restock/scan` | lib/api.ts:1092 | components/inventory/RestockSheet.tsx:5 | - | consumed (web+RN) |
| GET | `/api/restock/sessions` | lib/api.ts:1071 | components/inventory/RestockSheet.tsx:5 | - | consumed (web+RN) |
| POST | `/api/restock/start` | lib/api.ts:1073 | components/inventory/RestockSheet.tsx:5 | - | consumed (web+RN) |
| POST | `/api/returns` | lib/api.ts:419 | lib/api.ts:269 | - | consumed (web+RN) |
| PATCH | `/api/returns/:id` | lib/api.ts:424 | - | - | consumed (web) |
| POST | `/api/rfid/events` | - | - | packages/rfid-controller (confirmed) | consumed (external device sender) |
| GET | `/api/rooms` | features/today/HomeTabletDashboard.tsx:127 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/rooms` | features/today/HomeTabletDashboard.tsx:127 | lib/api.ts:269 | - | consumed (web+RN) |
| DELETE | `/api/rooms/:id` | lib/api.ts:808 | lib/api/rooms.ts:121 | - | consumed (web+RN) |
| GET | `/api/rooms/:id` | lib/api.ts:808 | lib/api/rooms.ts:121 | - | consumed (web+RN) |
| PATCH | `/api/rooms/:id` | lib/api.ts:808 | lib/api/rooms.ts:121 | - | consumed (web+RN) |
| GET | `/api/rooms/:id/activity` | lib/api.ts:829 | lib/api/rooms.ts:125 | - | consumed (web+RN) |
| GET | `/api/shift-adjustments` | features/shift-adjustments/ShiftAdjustmentControls.tsx:78 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/shift-adjustments` | features/shift-adjustments/ShiftAdjustmentControls.tsx:78 | lib/api.ts:269 | - | consumed (web+RN) |
| PATCH | `/api/shift-adjustments/:id` | lib/api.ts:689 | - | - | consumed (web) |
| POST | `/api/shift-adjustments/:id/cancel` | lib/api.ts:694 | lib/api/shift-adjustments.ts:167 | - | consumed (web+RN) |
| GET | `/api/shift-chat/archive/:shiftId` | features/shift-chat/components/ShiftChatArchive.tsx:24 | - | - | consumed (web) |
| GET | `/api/shift-chat/messages` | features/shift-chat/api.ts:7 | lib/api/shift-chat.ts:115 | - | consumed (web+RN) |
| POST | `/api/shift-chat/messages` | features/shift-chat/api.ts:7 | lib/api/shift-chat.ts:115 | - | consumed (web+RN) |
| POST | `/api/shift-chat/messages/:id/ack` | features/shift-chat/api.ts:18 | lib/api/shift-chat.ts:133 | - | consumed (web+RN) |
| POST | `/api/shift-chat/messages/:id/pin` | features/shift-chat/api.ts:25 | lib/api/shift-chat.ts:154 | - | consumed (web+RN) |
| POST | `/api/shift-chat/reactions` | features/shift-chat/api.ts:7 | lib/api/shift-chat.ts:139 | - | consumed (web+RN) |
| POST | `/api/shift-chat/typing` | features/shift-chat/api.ts:7 | lib/api/shift-chat.ts:146 | - | consumed (web+RN) |
| DELETE | `/api/shift-handover/:id/acknowledge` | lib/api.ts:1477 | lib/api/shift-handover.ts:142 | - | consumed (web+RN) |
| POST | `/api/shift-handover/:id/acknowledge` | lib/api.ts:1477 | lib/api/shift-handover.ts:142 | - | consumed (web+RN) |
| GET | `/api/shift-handover/current` | lib/api.ts:1474 | lib/api/shift-handover.ts:134 | - | consumed (web+RN) |
| GET | `/api/shifts` | lib/api.ts:644 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/shifts/import` | - | - | none found | NO-CONSUMER |
| POST | `/api/shifts/import/confirm` | lib/api.ts:667 | - | - | consumed (web) |
| POST | `/api/shifts/import/preview` | lib/api.ts:652 | - | - | consumed (web) |
| GET | `/api/shifts/import/shift-names` | lib/api.ts:646 | - | - | consumed (web) |
| GET | `/api/shifts/imports` | lib/api.ts:645 | - | - | consumed (web) |
| DELETE | `/api/stability/logs` | - | - | none found | NO-CONSUMER (documented dev-only) |
| GET | `/api/stability/logs` | - | - | none found | NO-CONSUMER (documented dev-only) |
| GET | `/api/stability/results` | - | - | none found | NO-CONSUMER (documented dev-only) |
| POST | `/api/stability/run` | - | - | none found | NO-CONSUMER (documented dev-only) |
| POST | `/api/stability/schedule` | - | - | none found | NO-CONSUMER (documented dev-only) |
| GET | `/api/stability/status` | - | - | none found | NO-CONSUMER (documented dev-only) |
| POST | `/api/stability/test-mode` | - | - | none found | NO-CONSUMER (documented dev-only) |
| POST | `/api/storage/upload-url` | lib/api.ts:572 | - | - | consumed (web) |
| GET | `/api/support` | lib/api.ts:753 | lib/api.ts:269 | - | consumed (web+RN) |
| POST | `/api/support` | lib/api.ts:753 | lib/api.ts:269 | - | consumed (web+RN) |
| PATCH | `/api/support/:id` | lib/api.ts:757 | - | - | consumed (web) |
| GET | `/api/support/unresolved-count` | lib/api.ts:757 | - | - | consumed (web) |
| POST | `/api/tasks/:id/complete` | lib/api.ts:736 | lib/api/tasks.ts:8 | - | consumed (web+RN) |
| POST | `/api/tasks/:id/start` | lib/api.ts:734 | lib/api/tasks.ts:8 | - | consumed (web+RN) |
| GET | `/api/tasks/active` | lib/api.ts:731 | lib/api/tasks.ts:8 | - | consumed (web+RN) |
| GET | `/api/tasks/dashboard` | features/today/hooks/use-today-shift.ts:21 | lib/api/tasks.ts:8 | - | consumed (web+RN) |
| GET | `/api/tasks/me` | lib/api.ts:728 | lib/api/tasks.ts:8 | - | consumed (web+RN) |
| GET | `/api/tasks/recommendations` | hooks/useTaskRecommendations.ts:11 | lib/api/tasks.ts:8 | - | consumed (web+RN) |
| POST | `/api/test/charge-alert/run` | - | - | test harness (QA/manual), gated requireNotProduction + isTestMode | TEST-ONLY |
| POST | `/api/test/create-scenario` | - | - | test harness | TEST-ONLY |
| POST | `/api/test/expiry-check/run` | - | - | test harness | TEST-ONLY |
| GET | `/api/test/notifications` | - | - | test harness | TEST-ONLY |
| GET | `/api/test/returns/:id` | - | - | test harness | TEST-ONLY |
| POST | `/api/test/run-scheduler` | - | - | test harness | TEST-ONLY |
| POST | `/api/uploads/avatar` | lib/api.ts:548 | - | - | consumed (web) |
| POST | `/api/uploads/fault-image` | - | - | none found | NO-CONSUMER |
| GET | `/api/users` | features/scan/TransferSheet.tsx:17 | lib/api.ts:269 | - | consumed (web+RN) |
| PATCH | `/api/users/:id/delete` | lib/api.ts:529 | - | - | consumed (web) |
| PATCH | `/api/users/:id/display_name` | lib/api.ts:541 | lib/api/account.ts:92 | - | consumed (web+RN) |
| PATCH | `/api/users/:id/equipment-coordinator` | lib/api.ts:510 | - | - | consumed (web) |
| PATCH | `/api/users/:id/restore` | lib/api.ts:531 | - | - | consumed (web) |
| PATCH | `/api/users/:id/role` | lib/api.ts:501 | - | - | consumed (web) |
| PATCH | `/api/users/:id/secondary-role` | lib/api.ts:505 | - | - | consumed (web) |
| PATCH | `/api/users/:id/senior-doctor-eligible` | lib/api.ts:515 | - | - | consumed (web) |
| PATCH | `/api/users/:id/status` | lib/api.ts:525 | - | - | consumed (web) |
| POST | `/api/users/apple-link` | lib/api.ts:309 | - | - | consumed (web) |
| POST | `/api/users/backfill-clerk` | - | - | none found | SUSPECTED NO-CONSUMER |
| DELETE | `/api/users/delete-account` | lib/api.ts:301 | lib/api/account.ts:107 | - | consumed (web+RN) |
| GET | `/api/users/deleted` | lib/api.ts:498 | - | - | consumed (web) |
| GET | `/api/users/managers` | pages/code-blue.tsx:49 | lib/api.ts:130 | - | consumed (web+RN) |
| GET | `/api/users/me` | native/NativeHeader.tsx:84 | lib/api.ts:104 | - | consumed (web+RN) |
| GET | `/api/users/me/shift-activity` | features/profile/ShiftActivityList.tsx:28 | - | - | consumed (web) |
| GET | `/api/users/pending` | lib/api.ts:497 | - | - | consumed (web) |
| GET | `/api/users/purge-candidates` | - | - | none found | SUSPECTED NO-CONSUMER |
| POST | `/api/users/purge-deleted` | - | - | none found | SUSPECTED NO-CONSUMER |
| POST | `/api/users/sync` | lib/api.ts:237 | - | - | consumed (web) |
| POST | `/api/webhooks/clerk` | - | - | Clerk (external, inbound webhook) | contract-surface |
| POST | `/api/whatsapp/alert` | lib/api.ts:584 | - | - | consumed (web) |
| GET | `/health` | - | - | none found | NO-CONSUMER |
| GET | `/health/data-integrity` | - | - | none found | NO-CONSUMER |
| GET | `/health/live` | - | - | none found | NO-CONSUMER |
| GET | `/health/startup` | - | - | none found | NO-CONSUMER |

### Notes (non-`consumed` rows only)

- **POST `/api/admin/cursor-bug-fixer/dispatch`** (`server/routes/cursor-bug-fixer.ts:80`) — Bare manual-dispatch variant (source:"manual"). Web only calls the ticket-scoped POST /api/admin/cursor-bug-fixer/support-tickets/:id/dispatch (api.ts:768). ARCHITECTURE_MAP.md: cursor-bug-fixer.service.ts is "Admin dispatch only" but no UI wires this specific bare route.
- **POST `/api/admin/rfid-provisioning/ack`** (`server/routes/admin-rfid-provisioning.ts:97`) — Admin-gated "record a snapshot reader adopting the new secret". Not called by web/RN/rfid-controller. Plausible intended caller is the physical RFID gateway hardware acking a rotation, but packages/rfid-controller (the only in-repo RFID sender) does not call it — only POST /api/rfid/events.
- **POST `/api/admin/rfid-provisioning/rollback`** (`server/routes/admin-rfid-provisioning.ts:78`) — Admin-gated secret-rotation grace-period rollback. Web rfidReaders client only has provision()/setIngest(). No web/RN caller found; no scripts/ caller. Plausibly ops-runbook-only (curl) or intended for a reader-side ack flow that isn't built — not found in packages/rfid-controller either.
- **POST `/api/admin/task-ownership/backfill`** (`server/routes/admin-task-ownership.ts:42`) — Whole admin-task-ownership.ts family (7 endpoints) has zero web/RN references. ARCHITECTURE_MAP.md documents "task-ownership admin queue" as part of the Tasks surface architecture, i.e. built-by-design, but no admin console page currently calls any of its 7 endpoints. The underlying queue IS populated by staleTaskOwnershipSweepWorker / taskOwnershipBackfill.worker (in-process, per CLAUDE.md), so data accumulates with no UI to view/act on it.
- **GET `/api/admin/task-ownership/backfill/:jobId`** (`server/routes/admin-task-ownership.ts:95`) — See POST /api/admin/task-ownership/backfill.
- **GET `/api/admin/task-ownership/queue`** (`server/routes/admin-task-ownership.ts:142`) — See POST /api/admin/task-ownership/backfill.
- **POST `/api/admin/task-ownership/queue/:id/confirm`** (`server/routes/admin-task-ownership.ts:369`) — See POST /api/admin/task-ownership/backfill.
- **POST `/api/admin/task-ownership/queue/:id/reject`** (`server/routes/admin-task-ownership.ts:380`) — See POST /api/admin/task-ownership/backfill.
- **POST `/api/admin/task-ownership/queue/:id/skip`** (`server/routes/admin-task-ownership.ts:389`) — See POST /api/admin/task-ownership/backfill.
- **GET `/api/admin/task-ownership/queue/count`** (`server/routes/admin-task-ownership.ts:169`) — See POST /api/admin/task-ownership/backfill.
- **POST `/api/clinical-check-in/check-ins/:id/admin-force-close`** (`server/routes/clinical-check-in.ts:252`) — Admin override to force-close a stuck clinical check-in. Web checkIn client + RN clinical-check-in.ts api only cover active/open/switch/close (self-service, non-admin). No admin console page calls the force-close variant.
- **GET `/api/clinical-check-in/me/operational-roles`** (`server/routes/clinical-check-in.ts:235`) — Not called by web (checkIn object) or RN (clinical-check-in.ts). Possibly superseded by the effective-role fields already returned inline by GET /api/users/me (api.ts:532 requests effectiveRole/roleSource/authority in one call).
- **GET `/api/code-blue/reconciliation`** (`server/routes/code-blue.ts:1222`) — Whole billing-reconciliation sub-family (4 endpoints) unreferenced in web api.ts's codeBlue object (which only covers sessions/events/history) or RN's code-blue.ts. Route doc comments describe an admin billing-reconciliation workflow ("Fix D") with no UI found calling any of the 4.
- **GET `/api/code-blue/sessions/:id/dispenses`** (`server/routes/code-blue.ts:1264`) — See GET /api/code-blue/reconciliation.
- **POST `/api/code-blue/sessions/:id/manual-billing`** (`server/routes/code-blue.ts:1375`) — See GET /api/code-blue/reconciliation.
- **PATCH `/api/code-blue/sessions/:id/reconcile`** (`server/routes/code-blue.ts:1313`) — See GET /api/code-blue/reconciliation.
- **POST `/api/dispense/:id/confirm`** (`server/routes/dispense.ts:116`) — Standalone dispense.ts family (3 endpoints) — a NON-clinical consumables dispense flow, distinct from the container-scoped `POST /api/containers/:id/dispense` that web's containers.dispense()/completeEmergency() actually call. RN has no dispense.ts api module either. Looks like a parallel/newer dispense surface never wired to any client.
- **POST `/api/dispense/draft`** (`server/routes/dispense.ts:89`) — See POST /api/dispense/:id/confirm.
- **POST `/api/dispense/emergency`** (`server/routes/dispense.ts:152`) — See POST /api/dispense/:id/confirm.
- **GET `/api/equipment-board/devices`** (`server/routes/display.ts:740`) — 2nd mount alias of display.ts (createDisplayRouter() mounted at BOTH /api/display and /api/equipment-board in routes.ts). Only /api/display/* paths have callers (web api.ts `display` object + shift-gate hooks). Zero references anywhere to the literal string "/api/equipment-board" in web or RN — the `shared/equipment-board` TYPE module some files import is a same-named-but-unrelated type file, not this URL. ARCHITECTURE_MAP.md notes both mounts exist but doesn't claim both are called.
- **DELETE `/api/equipment-board/devices/:id`** (`server/routes/display.ts:743`) — See GET /api/equipment-board/devices.
- **PATCH `/api/equipment-board/devices/:id`** (`server/routes/display.ts:741`) — See GET /api/equipment-board/devices.
- **POST `/api/equipment-board/devices/:id/revoke`** (`server/routes/display.ts:742`) — See GET /api/equipment-board/devices.
- **POST `/api/equipment-board/heartbeat`** (`server/routes/display.ts:737`) — See GET /api/equipment-board/devices.
- **POST `/api/equipment-board/pair/claim`** (`server/routes/display.ts:733`) — See GET /api/equipment-board/devices.
- **POST `/api/equipment-board/pair/issue`** (`server/routes/display.ts:732`) — See GET /api/equipment-board/devices.
- **GET `/api/equipment-board/snapshot`** (`server/routes/display.ts:736`) — See GET /api/equipment-board/devices. Notable: /api/display/snapshot is on the CLAUDE.md frozen emergency-endpoint cache denylist; the /api/equipment-board/snapshot alias serves the exact same handler but isn't in the denylist text (both are unconditionally bypassed together since the denylist matches by suffix in sw.js — verify if relying on this).
- **GET `/api/health`** (`server/routes/health.ts:118`) — No web/RN product-client caller (verified empirically — no /api/health literal anywhere in web_paths.tsv/rn_feature_paths.tsv). Consumed only by ops docs: docs/audit/PROOF_ALIGNMENT_LOG.md records scripts/check-db-readiness.sh polling this for deploy-gating (checks.db=="ok").
- **GET `/api/health/data-integrity`** (`server/routes/health.ts:178`) — No web/RN caller and no ops-doc reference found either (unlike sibling /api/health/live and /api/health/startup, which ARE referenced by runbooks/audit scripts). Only docs/architecture/routes-contract.json (stale, 2026-06-16 generated inventory) and docs/audit/routes.md (stale, 2026-07-08) mention it.
- **GET `/api/health/live`** (`server/routes/health.ts:14`) — No web/RN product-client caller. docs/vettrack-safari-audit.json embeds a browser fetch probe hitting this exact path as a synthetic health check.
- **GET `/api/health/ready`** (`server/routes/health.ts:118`) — 2nd mount alias of health.ts GET '/'. No client calls /api/health/ready bare (without a sub-path); only /api/health/ready/live etc. via the same alias are reachable in theory but likewise uncalled.
- **GET `/api/health/ready/data-integrity`** (`server/routes/health.ts:178`) — Alias path under the /api/health/ready mount; only the /api/health/data-integrity form is called.
- **GET `/api/health/ready/live`** (`server/routes/health.ts:14`) — Alias path; only /api/health/live is called.
- **GET `/api/health/ready/startup`** (`server/routes/health.ts:18`) — Alias path; only /api/health/startup is called.
- **GET `/api/health/startup`** (`server/routes/health.ts:18`) — No web/RN product-client caller. Multiple runbooks curl this path post-deploy to verify databaseReachable:true.
- **POST `/api/integration-webhooks/:adapterId`** (`server/routes/integrations/webhooks/inbound.router.ts:58`) — Raw-body HMAC-verified inbound webhook receiver for external PMS/vendor integrations (server/integrations/webhooks/inbound.router.ts). By design, the caller is an external vendor system, not traceable via repo grep.
- **GET `/api/integrations/analytics/product`** (`server/routes/integrations.ts:187`) — Route's own doc comment: "Product analytics stub (zeros until Phase D)" (integrations.ts top-of-file permissions matrix). Intentionally unimplemented placeholder, not a UI-wiring miss.
- **GET `/api/integrations/billing/mismatch-report`** (`server/routes/integrations.ts:88`) — In-code comment tags it "Phase D Sprint 3". Admin-gated, zero web/RN callers — built ahead of its console UI.
- **GET `/api/integrations/configs/:adapterId/logs`** (`server/routes/integrations.ts:684`) — Not called by web integrations object (dashboard/health/adapters/listConfigs/getConfig/runs/mappingsReview/upsert/patch/delete/storeCredentials/validate/runSync/updateMapping/retryRun/replayWebhook are all wired; .logs is not).
- **POST `/api/integrations/configs/:adapterId/promote`** (`server/routes/integrations.ts:635`) — Doc comment: "Vendor X promote environment (confirmed)" — vendor-specific admin action, not wired to the IntegrationsConsolePage.
- **POST `/api/integrations/configs/:adapterId/rollback`** (`server/routes/integrations.ts:579`) — Doc comment: "Vendor X rollback (disable config + schedules)" — vendor-specific admin action, not wired to the IntegrationsConsolePage.
- **POST `/api/integrations/ops/sync/window`** (`server/routes/integrations/routes/ops.routes.ts:208`) — Sibling ops-subrouter endpoints retryRun + replayWebhook ARE wired (api.ts integrations.retryRun/replayWebhook); sync/window ("Bounded window sync job") is not.
- **GET `/api/inventory-items/:id/prices`** (`server/routes/inventory-items.ts:388`) — Context-specific multi-price feature on inventory-items.ts. No reference to "price"/"Price" anywhere in src/pages/inventory-items.tsx or the inventoryItems api client (list/lowStock/detail/create/update/delete only).
- **POST `/api/inventory-items/:id/prices`** (`server/routes/inventory-items.ts:330`) — See GET /api/inventory-items/:id/prices.
- **GET `/api/queue/dlq`** (`server/routes/queue.ts:94`) — Web's adminQueueMetrics client only calls GET /api/queue/metrics. The parallel outbox DLQ (admin-outbox-dlq.ts) HAS a full list/retryAll/drop UI wired (adminOutboxDlq in api.ts) — the BullMQ queue's OWN dlq endpoints do not, an asymmetry worth flagging.
- **POST `/api/queue/dlq/:jobId/replay`** (`server/routes/queue.ts:127`) — See GET /api/queue/dlq.
- **POST `/api/rfid/events`** (`server/routes/rfid.ts:49`) — packages/rfid-controller/src/sender.ts:60 builds this exact URL (`${apiOrigin}/api/rfid/events`) and contract.ts:60 documents the signed-batch body posted here. Mounted directly in server/index.ts (mountRfidRoutes, raw-body HMAC) rather than via routes.ts.
- **POST `/api/shifts/import`** (`server/routes/shifts.ts:822`) — Single-step multer CSV import. Web's shifts client only uses the two-step flow: POST /api/shifts/import/preview then POST /api/shifts/import/confirm (api.ts:647-676). This bare /import (no /preview or /confirm suffix) looks superseded by that flow but was not removed.
- **DELETE `/api/stability/logs`** (`server/routes/stability.ts:68`) — ARCHITECTURE_MAP.md, under "Dead features & stubs": "/api/stability | Dev/stability tooling; low product traffic", and under "Orphaned / low-reference modules": "server/routes/stability.ts | Stability runner — dev/ops only". No web/RN caller found for any of its 7 endpoints; admin-gated but not NODE_ENV-gated except /test-mode and /schedule.
- **GET `/api/stability/logs`** (`server/routes/stability.ts:62`) — See DELETE /api/stability/logs.
- **GET `/api/stability/results`** (`server/routes/stability.ts:58`) — See DELETE /api/stability/logs.
- **POST `/api/stability/run`** (`server/routes/stability.ts:40`) — See DELETE /api/stability/logs.
- **POST `/api/stability/schedule`** (`server/routes/stability.ts:91`) — See DELETE /api/stability/logs.
- **GET `/api/stability/status`** (`server/routes/stability.ts:28`) — See DELETE /api/stability/logs.
- **POST `/api/stability/test-mode`** (`server/routes/stability.ts:74`) — See DELETE /api/stability/logs.
- **POST `/api/test/charge-alert/run`** (`server/routes/test.ts:158`) — ARCHITECTURE_MAP.md "Dead features & stubs": "/api/test/* | Test-only scheduler triggers". Route file itself is gated off in production and behind an explicit test-mode flag.
- **POST `/api/test/create-scenario`** (`server/routes/test.ts:43`) — See POST /api/test/charge-alert/run.
- **POST `/api/test/expiry-check/run`** (`server/routes/test.ts:135`) — See POST /api/test/charge-alert/run.
- **GET `/api/test/notifications`** (`server/routes/test.ts:114`) — See POST /api/test/charge-alert/run.
- **GET `/api/test/returns/:id`** (`server/routes/test.ts:178`) — See POST /api/test/charge-alert/run.
- **POST `/api/test/run-scheduler`** (`server/routes/test.ts:36`) — See POST /api/test/charge-alert/run.
- **POST `/api/uploads/fault-image`** (`server/routes/uploads.ts:69`) — Web's uploadAvatar is the only uploads.* caller in api.ts. The native ReportEquipmentIssueSheet.tsx explicitly comments that "photo attach" is a "desktop-only extra" living elsewhere; the desktop counterpart (components/report-issue-dialog.tsx) was checked directly and contains no upload/photo/fault-image code either. Feature appears to have been designed for but never wired on either surface.
- **POST `/api/users/backfill-clerk`** (`server/routes/users.ts:1216`) — Admin+authSensitiveLimiter gated one-time Clerk-ID backfill migration. No web/RN caller, no scripts/ caller — plausibly a run-once curl action already exercised historically and left in place, or still pending.
- **GET `/api/users/purge-candidates`** (`server/routes/users.ts:1134`) — Admin GDPR-style hard-delete-candidate listing. No web/RN/scripts caller found.
- **POST `/api/users/purge-deleted`** (`server/routes/users.ts:1159`) — Paired mutation for the above; no caller found.
- **POST `/api/webhooks/clerk`** (`server/routes/webhooks.ts:60`) — svix-signed inbound webhook from Clerk's servers, mounted before express.json() for raw-body verification. By design, external, not traceable via repo grep.
- **GET `/health`** (`server/routes/health.ts:118`) — Bare 3rd mount of health.ts alongside /api/health + /api/health/ready. Railway healthcheckPath is /api/healthz (PROOF_ALIGNMENT_LOG.md), not bare /health; ops runbooks/audit-script curl the /api/health/* forms, never bare /health. ARCHITECTURE_MAP.md calls the triple-mount "intentional redundancy for probes" but no in-repo prober targets the bare path specifically. Only structural reference: tests/routes-registration-contract-slice7.test.ts (mount-list assertion, not behavioral).
- **GET `/health/data-integrity`** (`server/routes/health.ts:178`) — Same as /health/live.
- **GET `/health/live`** (`server/routes/health.ts:14`) — Same triple-mount as above; only /api/health/live and /api/health/ready/live have callers (web lib/api.ts, lib/auth-fetch.ts).
- **GET `/health/startup`** (`server/routes/health.ts:18`) — Same as /health/live.

