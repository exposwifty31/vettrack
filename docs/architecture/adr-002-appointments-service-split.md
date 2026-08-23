# ADR-002 — appointments.service.ts Decomposition Plan

**Date:** 2026-04-25  
**Status:** Accepted — pending implementation. **Superseded-in-place 2026-08-23** — the original 3-way split target no longer matches the file; see "2026-08-23 update" below. Still pending implementation against the corrected target.
**Context:** Item 2.5 — `appointments.service.ts` is 1,692 lines (God class)

---

## Context

`server/services/appointments.service.ts` handles three distinct concerns that have grown together:

1. **Scheduling** — create/update/cancel appointments, conflict detection, status state machine
2. **Task lifecycle** — start, complete, vet-approve; technician task queries (today, by priority, active)
3. **Medication execution** — dose resolution, billing, container resolution, inventory deduction queue

This coupling makes it harder to:
- Reason about individual workflows
- Test in isolation
- Onboard new engineers

---

## 2026-08-23 update — medication execution is gone, the export list drifted

An implementation attempt (Wave 6 tech-debt pass) found this ADR stale and stopped rather than fabricate missing code. Verified independently before this update:

- **`e5d5ac8ed`** ("Merge PR4 equipment-focused scope into main", 2026-06-02 — five weeks after this ADR was accepted) deleted the entire medication-execution surface as part of the scope change `docs/scope-change-2026.md` documents ("migrations 142 and 143 narrowed VetTrack to an equipment-first hospital operations platform... medication tasks, drug formulary, and pharmacy forecast were removed") — also independently confirmed in `CLAUDE.md`'s own "Removed (migrations 142–143)" list. `MedicationExecutionTask`, `MedicationExecutionInput`, `resolveMedicationTaskContainerId`, `getActiveMedicationTasks`, and the internal helpers this ADR named (`resolveMedicationDedupFingerprint`, `findOpenDuplicateMedicationAppointment`) have zero remaining references anywhere in the repo. The file now actively rejects the workflow at runtime (`AppointmentServiceError("MEDICATION_TASKS_DISABLED", ...)`) rather than merely lacking it.
- The same commit also deleted `vetApproveTask` — not part of the medication cleanup this ADR anticipated, but gone via the same merge. No renamed equivalent exists (`git log -S"vetApproveTask"` shows only its introduction and this deletion). It was vet approval of a *medication* dose; it has no meaning without the medication workflow it approved.
- Four exports now exist that this ADR never accounted for (added after 2026-04-25, presumably by the Phase 2.5/5 authority-enforcement work): `applyTaskAssignmentEvaluator`, `applyStaleTaskOwnershipObservation`, `toUtcDate`, `assertWithinVetShift`. Categorized below by actual call-graph (grep for each call site in the current file), per this ADR's own "helpers follow their primary consumer" rule.

**The split is now two-way, not three.** `medication-execution.service.ts` is dropped entirely — there is nothing left to extract into it.

### Corrected target files (supersedes the table below)

| File | Exports | Notes |
|------|---------|-------|
| `server/services/scheduling.service.ts` | `AppointmentInput`, `AppointmentUpdateInput`, `AppointmentServiceError`, `AppointmentStatus`, `createAppointment`, `updateAppointment`, `cancelAppointment`, `getAppointmentsByDay`, `getAppointmentsByVet`, `listAppointmentsByRange`, `toUtcDate`, `assertWithinVetShift` | `toUtcDate`/`assertWithinVetShift` called only from `createAppointment`/`updateAppointment`/the range-query functions — verified via grep, never from a task-lifecycle function. Imports `TaskAuditActor` (actor param type) and `applyTaskAssignmentEvaluator` from `task-lifecycle.service.ts` — this cross-import direction already existed implicitly in the original ADR (scheduling functions already take `actor?: TaskAuditActor`, a task-lifecycle-owned type). |
| `server/services/task-lifecycle.service.ts` | `TaskAuditActor`, `TaskPriority`/`TaskType` re-export (moved here from the top-level re-export — only task-query functions consume them), `startTask`, `completeTask`, `getTasksForTechnician`, `getTasksForTechnicianToday`, `getTasksByPriority`, `getActiveTasks`, `getTodayTasks`, `applyTaskAssignmentEvaluator`, `applyStaleTaskOwnershipObservation` | `vetApproveTask` dropped (see above). `applyTaskAssignmentEvaluator` is called from 3 sites — 2 in scheduling (`createAppointment`, `updateAppointment`), 1 here (`startTask`) — assigned here because the name and the authority-evaluator wiring it does ("task assignment") is a task-lifecycle concept even where scheduling triggers a re-check. `applyStaleTaskOwnershipObservation` is called only from `startTask`/`completeTask`, no ambiguity. |
| ~~`server/services/medication-execution.service.ts`~~ | **Dropped — nothing to extract, see above.** | |
| `server/services/appointments.service.ts` | Barrel re-exports from the two files above | |

The original three-way table immediately below is preserved for history; it does not reflect the current file and should not be implemented as written.

---

## Decision

Split into three focused services. The split is boundary-preserving — all public API surfaces stay stable, callers update their import paths only.

### Target files

| File | Exports | ~Lines |
|------|---------|--------|
| `server/services/scheduling.service.ts` | `AppointmentInput`, `AppointmentUpdateInput`, `AppointmentServiceError`, `AppointmentStatus`, `createAppointment`, `updateAppointment`, `cancelAppointment`, `getAppointmentsByDay`, `getAppointmentsByVet`, `listAppointmentsByRange` | ~400 |
| `server/services/task-lifecycle.service.ts` | `TaskAuditActor`, `startTask`, `completeTask`, `vetApproveTask`, `getTasksForTechnician`, `getTasksForTechnicianToday`, `getTasksByPriority`, `getActiveTasks`, `getTodayTasks` | ~700 |
| `server/services/medication-execution.service.ts` | `MedicationExecutionTask`, `MedicationExecutionInput`, `resolveMedicationTaskContainerId`, `getActiveMedicationTasks` | ~300 |
| `server/services/appointments.service.ts` | Barrel re-exports from all three above (for backwards compatibility during migration) | ~30 |

### Internal helpers

Private helpers (`resolveMedicationDedupFingerprint`, `findOpenDuplicateMedicationAppointment`, etc.) follow their primary consumer into the appropriate file. **(Superseded — these no longer exist; see the 2026-08-23 update above.)**

---

## Implementation order

**Superseded by the 2026-08-23 update — follow this order against the corrected two-file target:**

1. Extract `scheduling.service.ts` first (least coupled; note it now imports `TaskAuditActor` and `applyTaskAssignmentEvaluator` from `task-lifecycle.service.ts`, so either extract `task-lifecycle.service.ts` first, or stub the import and wire it once both files exist)
2. Extract `task-lifecycle.service.ts`
3. Convert `appointments.service.ts` to barrel re-exports
4. Run full test suite after each extraction

Original (stale) order, preserved for history:

1. ~~Extract `scheduling.service.ts` first (least coupled)~~
2. ~~Extract `medication-execution.service.ts` (isolated domain)~~ — nothing to extract
3. ~~Extract `task-lifecycle.service.ts` last (most internal cross-references)~~
4. ~~Convert `appointments.service.ts` to barrel re-exports~~
5. ~~Run full test suite after each extraction~~

---

## Consequences

- No behaviour changes — pure file reorganisation
- All existing tests continue to pass (imports update automatically if barrel is preserved)
- Each resulting file is ≤700 lines and has a single responsibility — the corrected target is two files (scheduling and task-lifecycle), not three; the medication-execution line-count estimate never applied
- Estimated effort: one focused engineer-day
