# Pilot STEP 8 — Full repository debug pass

**Date:** 2026-05-26  
**Mainline SHA:** `d126e03b` (after #487 Codex follow-up, #486 STEP 7 docs)  
**Executor:** Cursor Cloud Agent  
**Reviewer:** Program Brain  

---

## Executive summary

| Gate | Result |
|------|--------|
| Typecheck (`npx tsc --noEmit`) | **PASS** |
| Default Vitest (`pnpm test`) | **PASS** — 306 files, 4065 tests |
| Production build (`pnpm build`) | **PASS** |
| Pilot-critical suites (CB, DLQ, tenancy, peer-cursor guard) | **PASS** — 35 tests |
| Integration ops (local) | **SKIP** — DB schema behind mainline (`custody_state` probe); CI runs fresh Postgres + migrate |
| Code fixes required this step | **None** — no new P0/P1 defects on mainline |

**Recommendation:** Proceed to **STEP 9 (pilot report)**. Track open P2/P3 items in `BUG_REGISTER.md`; no merge-blocking code changes identified.

---

## Merges verified (Program Brain order)

| PR | SHA (merge) | Scope |
|----|-------------|--------|
| #487 | `38e76d08` | Peer cursor-zero reset guarded by `clinicId` in BroadcastChannel gossip |
| #486 | `d126e03b` | Pilot runbook + `.env.example` (STEP 7) |

---

## Verification matrix

### Automated (agent-run on `main` @ `d126e03b`)

```bash
npx tsc --noEmit          # exit 0
pnpm test                 # 4065 passed (vitest excludes DB/live-server suites per vite.config.ts)
pnpm build                # exit 0
pnpm test -- tests/cross-tenant-denial.test.ts \
  tests/code-blue-offline-queue-removed.test.ts \
  tests/peer-cursor-prune-clinic-guard.test.ts \
  tests/admin-outbox-dlq-api.test.ts   # 35 passed
```

### CI parity (expected green on `main`)

- Merge gate, Tests & typecheck, Integration ops (Postgres 16 + `pnpm migrate`), Playwright E2E shards.

### Local environment caveats

| Issue | Impact | Mitigation |
|-------|--------|------------|
| `pnpm db:migrate` fails on dirty DB (`065_core_table_fk_constraints.sql` — orphan `vt_users.clinic_id`) | Extra schema tests fail if `DATABASE_URL` is set to a stale DB | Use fresh Postgres for integration work; CI is authoritative |
| `pnpm test:integration:ops` skips when `custody_state` column absent | Local skip ≠ CI failure | Run `pnpm migrate` on clean DB before integration ops |
| Vitest setup injects dummy `DATABASE_URL` when unset | Default `pnpm test` does not hit real DB | Matches CI unit-test posture |

---

## Pilot-readiness surface audit (post STEPS 1–7)

| Area | Status | Notes |
|------|--------|-------|
| Code Blue client API | OK | Session paths use `api.codeBlue.sessions.*`; offline block intact |
| Realtime SSE + replay | OK | `onopen` HTTP catch-up; peer cursor `0` clinic-scoped (#487) |
| Sync engine multi-tab | OK | `navigator.locks` `vt-sync-queue` |
| Outbox DLQ admin | OK | Clinic-scoped routes + UI on ops dashboard |
| JR-MIG job runtime | OK | Expiry + stale-checkin via `startJobRuntime()` only |
| Cross-tenant reads | OK | `tests/cross-tenant-denial.test.ts` green |
| `.env.example` / pilot runbook | OK | SSE documented; legacy `VITE_WS_URL` comment-only |

---

## Findings (no code changes this step)

### Closed since pilot execution began

- Codex P1 cross-clinic BroadcastChannel reset — fixed in #487.
- STEP 6 CB/realtime/sync bundle — merged #485.
- P1 cross-tenant PO/alert-ack reads — merged #308.
- Equipment optimistic `version` enforcement — present on main (`server/routes/equipment.ts`).

### Open — non-blocking for pilot (see `BUG_REGISTER.md`)

| ID | Sev | Summary | Disposition |
|----|-----|---------|-------------|
| CD-01 | P2 | ER `GET /api/er/queue` listed but 501 | Document / post-pilot |
| CD-03 | P2 | Raw `fetch()` outside `api.ts` in auth/sync/tour | Known; auth/sync intentional |
| AU-01 | P1 | Playwright scope vs signup-flow | CI uses sharded safe set — verify workflow allowlist periodically |
| VA-01 | P2 | Most Zod routes not `.strict()` | Harden incrementally |
| IB-01 | P3 | Async inventory after `completeTask` | Documented expected skew |

### i18n debt (allowlisted)

- `src/pages/leakage-report.tsx` — hardcoded Hebrew error string (in `KNOWN_DEBT_ALLOWLIST`); extract in Phase 6 debt PR, not pilot blocker.

---

## Frozen surfaces

No modifications in STEP 8. Realtime/SSE/outbox, SW emergency denylist, and Code Blue offline classifier were **read-only** during this pass.

---

## Next step

**STEP 9 — Pilot report:** synthesize operator-facing go/no-go, open risks from this register, and deployment checklist referencing `docs/pilot.md` mainline runbook.
