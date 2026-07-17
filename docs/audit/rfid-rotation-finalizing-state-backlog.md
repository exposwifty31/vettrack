# RFID rotation: transient `completed` during finalize-vs-rollback — deferred hardening

> **STATUS: RESOLVED (FS-1, 2026-07-18).** Implemented on branch
> `claude/rfid-gates-board-alerts` (extends PR #113). The `finalizing` intermediate state
> now sits between `grace` and `completed`, so `completed` is committed ONLY after the durable
> credential delete. Delivered by: migration `176_vt_rfid_secret_rotations_finalizing_status.sql`
> (widens the status CHECK), the two-phase `finalizeRotation` + `finalizing`-aware
> `ackRotationReader` / `getRfidVerificationSecrets` / `rollbackRfidSecret` in
> `server/lib/rfid/provisioning.ts`, the `RotationStatus` / `RfidRotationStatus` unions, and the
> FS-1 tests in `tests/rfid-provisioning.test.ts`. Kept for provenance — do not delete.

Tracked deferral of a CodeRabbit finding on `server/lib/rfid/provisioning.ts`
(finalize-vs-rollback), review comment id `3606912682`. Deliberately deferred at
the tail of an asymptotic review — logged here so it is not lost.

## The edge

`finalizeRotation` CAS-commits the rotation row to `completed` **before** the
external credential-store delete of the retained previous secret. If that delete
fails, the compensating transition reverts the row to `grace`. In the sub-millisecond
window between the CAS commit and a delete-failure revert, a concurrent acker that
re-reads the row can observe the transient `completed` and momentarily report
`completed` for a rotation that ends up back in `grace`.

## Impact

- **Compound-rare:** requires a credential-store delete failure AND a concurrent
  ack landing inside a sub-ms window.
- **Self-healing:** the row reverts to `grace` and the flow remains recoverable.
- **No data loss, no security impact, no tenancy impact.** Ingest stays correct
  during grace (it verifies current OR previous throughout the grace window).
- **Strictly better than the pre-fix state,** which could commit a terminal
  `completed`/`rolled_back` row that no longer matched the stored secrets
  (guaranteed-inconsistent). The fix already narrows this to a transient, self-healing
  misreport.

## The clean fix

Introduce a `finalizing` intermediate rotation state so the row is never observably
`completed` until the external delete succeeds. This requires:

- a migration widening the `status` CHECK constraint to include `finalizing`,
- rewiring `finalizeRotation` (CAS to `finalizing` → delete → CAS to `completed`),
- both `ackRotationReader` branches (finalize path + concurrent-rollback re-read),
- `getRfidVerificationSecrets` (treat `finalizing` like grace for ingest),
- `rollbackRfidSecret` (handle a `finalizing` row).

It is a dedicated hardening pass with its own migration, tests, and review.

## Why deferred

Heavy-lift change on the security-adjacent rotation state machine at the tail of an
asymptotic review. The blast radius of the fix (migration + five call sites on the
credential-rotation path) exceeds the impact of the rare, self-healing edge it closes.
Schedule as a standalone hardening task rather than folding it into the current PR.
