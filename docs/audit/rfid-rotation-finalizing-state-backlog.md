# RFID rotation: transient `completed` during finalize-vs-rollback — deferred hardening

> **STATUS: RESOLVED (FS-1, 2026-07-18).** Implemented on branch
> `claude/rfid-gates-board-alerts` (extends PR #113). The `finalizing` intermediate state
> now sits between `grace` and `completed`, so `completed` is committed ONLY after the durable
> credential delete. Delivered by: migration `176_vt_rfid_secret_rotations_finalizing_status.sql`
> (widens the status CHECK), the two-phase `finalizeRotation` + `finalizing`-aware
> `ackRotationReader` / `getRfidVerificationSecrets` / `rollbackRfidSecret` in
> `server/lib/rfid/provisioning.ts`, the `RotationStatus` / `RfidRotationStatus` unions, and the
> FS-1 tests in `tests/rfid-provisioning.test.ts`. Kept for provenance — do not delete.
>
> **RE-ATTEMPT HARDENING (2026-07-18, liveness fix).** The first FS-1 cut introduced a NEW
> liveness defect flagged in review: a HARD process crash (SIGKILL/OOM/deploy restart) between the
> Phase-1 `grace`→`finalizing` CAS and the Phase-3 commit left the row stranded `finalizing` with
> `previous_retained=true`, permanently holding the one-in-flight gate (`UNIQUE (clinic_id) WHERE
> previous_retained=true`) → `rotateRfidSecret` bricked forever (worse than pre-FS-1
> recoverability). Fixed by making finalize idempotently reclaimable: `finalizeRotation`'s Phase-1
> CAS now claims `status='grace'` OR a **stale** `status='finalizing'` (`updated_at <= now −
> FINALIZING_STALE_MS`, 60s — never stomps an actively in-flight finalize; the CAS re-stamp also
> serializes concurrent reclaimers). `getRfidVerificationSecrets` re-drives a stranded `finalizing`
> row (not just a grace-expired one), so the lazy ingest path actually COMPLETES a stranded finalize
> and releases the gate (previously a silent no-op). New bounded counter
> `rfid_secret_rotation_reclaimed`. New crash-recovery test in `tests/rfid-provisioning.test.ts`.
>
> **RE-ATTEMPT ROUND 2 (2026-07-18, POST-delete window + time-bounded backstop).** Review flagged
> that the lazy-only reclaim above closes only HALF the crash window: (HIGH) a crash in the
> POST-delete sub-window — after Phase-2 durably removed `previous` from the credential blob but
> before the Phase-3 status CAS — strands the row `finalizing`/`previous_retained=true` while the
> blob no longer carries `previous`, so `getRfidVerificationSecrets` short-circuits at its
> `!previous` early return (the frozen no-extra-query common path) and NEVER re-drives finalize →
> gate bricked forever; (MEDIUM) even the pre-delete window depends on CONTINUED ingest traffic, so
> a clinic whose readers fall quiet right after stranding holds the gate with no upper bound. Fixed
> with a scheduled backstop (fix-direction: sweeper): `reclaimStrandedFinalizingRotations()` in
> `server/lib/rfid/provisioning.ts` finds every STALE `finalizing` row (`updated_at <= now −
> FINALIZING_STALE_MS`, `previous_retained=true`) and re-drives it through the same two-phase
> finalize regardless of blob state (Phase-2 delete is an idempotent no-op when `previous` is already
> gone). Scheduled at a fixed 60s cadence by `startRfidFinalizingSweep()`
> (`server/lib/rfid/finalizing-sweep.ts`, registered in `server/app/start-schedulers.ts`), so a
> stranded gate is released within one sweep interval even with zero ingest/ack traffic. This closes
> the HIGH post-delete window AND the MEDIUM quiet-clinic case uniformly, without touching the frozen
> hot ingest path. New DB-integration test (LOW test-gap): a stranded `finalizing` row with the
> blob's `previous` ALREADY stripped — the lazy ingest path leaves it stranded (asserted), then the
> scheduled sweep reclaims it and releases the gate.

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
