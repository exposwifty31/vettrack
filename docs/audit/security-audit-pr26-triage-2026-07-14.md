# Security audit (PR #26 `SECURITY_REPORT.md`) — triage & disposition

**2026-07-14.** PR #26 added a root-level forensic `SECURITY_REPORT.md` (evidence-anchored audit across auth, authorization, multi-tenant isolation, DB, workers, frontend state, webhooks, tests). The PR was 16 days stale (CHANGES_REQUESTED, root-level clutter). Triaged its findings against current `main` and closed the PR; this note preserves the conclusions.

## Verdict: no open CONFIRMED vulnerabilities

Every finding is either `CONFIRMED ✅` (property verified **secure** against the cited path) or `CONFIRMED ⚠️` (a known weakness that is **accepted by design / low-severity / architectural**). None is an open exploitable hole.

**Verified-secure (✅):** single server-side identity source (A1); prod cannot start in dev-bypass (A2); single clinical authority resolver + enforcement envelope with fail-safe degradation (B1/B4); student hard-stop + shift-role ceiling (B3); client cannot spoof `clinicId` — `requireAuth` overwrites `req.clinicId` from the DB user (C3); prior IDOR G-1 remediated + regression-locked (C4); consistent parameterization, no SQLi on audited surfaces (D1); correct locking/transaction boundaries (D2); idempotency = Redis cache + DB uniqueness, confirm-level replay safety, deduction worker is a deprecated no-op (E1/E2); webhook signature boundary (1.7); test posture (1.8).

**Accepted-by-design / low (⚠️) — reviewed, no action required:** gated legacy/override auth paths (A3); env-driven admin grant `isAdminEmail` (A4); isolation is 100% application-enforced with no DB backstop (C1, architectural — every query filters `clinicId`, tenant-lint enforced); `containerItems` UPDATE-by-id defense-in-depth (D3, low); Zustand declared-but-unused hygiene (F2).

## The one traceability follow-up (I3) — verified addressed

I3 asked whether exhausted BullMQ job failures surface to ops end-to-end. **Confirmed handled in current `server/jobs/runtime.ts`:** `worker.on("failed")` logs the failure, increments the bounded `queue_jobs_dead_letter` counter, and enqueues the job to a **pilot DLQ** (`removeOnFail: 100` retains failed jobs). The new per-job-kind latency metrics (`getMetricsSnapshot().jobLatency`) additionally record failed executions. Residual is purely ops-side: wiring an external alert on the `queue_jobs_dead_letter` counter / DLQ depth — a monitoring-config task, not a code gap.

## Disposition

PR #26 closed (stale root-level doc; conclusions preserved here). No code change required — the audit confirms the security posture is sound.
