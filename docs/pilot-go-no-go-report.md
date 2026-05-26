# VetTrack mainline pilot — Go / No-Go report (STEP 9)

**Report date:** 2026-05-26  
**Mainline reference:** `d126e03b` (`main` after #486, #487)  
**Sources:** `docs/pilot.md`, `docs/pilot-step8-debug-pass.md`, `BUG_REGISTER.md`, Program Brain pilot execution lock order  
**Authority:** CI merge gate on `main` is **authoritative** for pass/fail. Local agent or developer environments may skip integration tests or fail migrations on dirty databases; those results do **not** override green CI.

---

## Executive summary

VetTrack **mainline** (full stack, not equipment-only `PILOT_MODE`) completed a locked pilot-readiness execution sequence: critical correctness, tenancy hardening, CI integration ops gate, job-runtime migration, outbox DLQ admin UX, Code Blue / realtime / sync client fixes, documentation, Codex follow-up, and a full-repository debug pass.

| Dimension | Assessment |
|-----------|------------|
| Merge-blocking defects on `main` | **None identified** in STEP 8 |
| Frozen architecture surfaces | **Unchanged** in pilot PRs (extend-only) |
| CI signal on `main` | **Green** (merge gate, tests, integration ops, Playwright shards) |
| Operator runbooks | **Published** (`docs/pilot.md`, this report, operator checklist) |

**Go / No-Go:** **GO** for controlled hospital pilot on mainline, subject to operational prerequisites (PostgreSQL 16, Redis in production, Clerk production keys, green deploy from `main`) and acceptance of documented P2/P3 residual risk in `BUG_REGISTER.md`.

---

## Final "Poet vs Code" verdict

| Role | Name in program | Responsibility |
|------|-----------------|----------------|
| **Poet** | Program Brain | Locked execution order, merge authority, go/no-go policy |
| **Code** | Cursor Cloud Agent | Implementation, tests, PRs, evidence packages |

**Verdict: ALIGNED FOR PILOT SCOPE**

- **Poet** defined STEPS 1–10, approved each merge (#478 → #487), and required evidence before merge.
- **Code** delivered scoped PRs per step without expanding frozen surfaces; STEP 8 found no new P0/P1 on mainline.
- **Disagreement resolved:** Codex P1 on cross-tab cursor reset (#485) was fixed in #487 before STEP 7–8 docs landed.
- **Outstanding:** STEP 8 report PR **#488** (docs-only debug pass artifact) may merge after this report; it does not change the go/no-go technical posture.

Poet retains merge authority; Code does not self-merge to production.

---

## P0 / P1 / P2 status table

### P0 (production / safety — must be zero for unconditional go)

| ID | Finding | Pilot status | Notes |
|----|---------|--------------|-------|
| SE-01 | Clerk live keys in git history (ops rotation) | **OPS — verify** | Outside application code; run `docs/runbooks/1.4-clerk-key-rotation.md` if not completed |

No open **application** P0 on `main` from pilot execution.

### P1 (high — closed in pilot vs open residual)

| ID | Finding | Pilot status | Evidence |
|----|---------|--------------|----------|
| — | Staging cancel / inventory tx / Redis enqueue | **CLOSED** | #478 |
| — | Cross-tenant PO / alert-ack reads | **CLOSED** | #308 |
| — | Codex: peer cursor `0` cross-clinic reset | **CLOSED** | #487 |
| CO-01 | Equipment `version` OCC | **CLOSED on main** | Implemented in `server/routes/equipment.ts` (STEP 8 audit); register predates fix |
| AU-01 / TI-01 / TI-04 | Playwright CI scope vs signup-flow | **MITIGATED** | CI uses sharded safe E2E set; periodic workflow review recommended |
| DP-03 | CI not on `staging` branch PRs | **OPEN** | Process risk for `staging`-only workstreams |
| IB-03 | Negative inventory at DB layer | **OPEN — confirm** | Service guards; run data-integrity checks in pilot clinic |

### P2 (medium — accepted for pilot with monitoring)

Representative open items (full list: `BUG_REGISTER.md`):

| ID | Summary | Pilot disposition |
|----|---------|-------------------|
| CD-01 | ER `GET /api/er/queue` documented but 501 | Do not depend on queue API in pilot |
| CD-03 | Raw `fetch()` outside `api.ts` (auth/sync) | Known exceptions; no pilot change |
| TZ-01 | UTC "today" for tasks | Operators aware of boundary behavior |
| EU-01 | No toast on permanent sync failure | Monitor ops dashboard sync telemetry |
| VA-01 | Zod routes mostly non-strict | Incremental hardening post-pilot |
| SE-05 | Data-integrity health token optional | Set `DATA_INTEGRITY_HEALTH_TOKEN` in prod |
| AU-02 | ER handoff ack route guard | Service-layer auth still applies |

### P3

Tracked in `BUG_REGISTER.md` (IB-01 async inventory skew, PF/DP hygiene, i18n allowlist debt). **Not pilot blockers.**

---

## Architecture frozen-surface verification

Pilot PRs **did not replace** frozen transports or emergency doctrine. Verification method: STEP 8 read-only audit + PR file lists.

| Frozen surface | Requirement | Pilot execution |
|----------------|-------------|-----------------|
| Realtime transport | SSE + outbox only; no WebSocket replacement | **OK** — client uses `/api/realtime/stream`; `.env.example` deprecates `VITE_WS_URL` |
| Outbox / replay | Monotonic cursor; HTTP replay on reconnect | **OK** — STEP 6 `onopen` catch-up; #487 clinic-scoped cursor gossip |
| BroadcastChannel envelope | `cursor`, `buildTag`, `ts`, `senderNonce`, `kind` | **OK** — additive `clinicId` in cursor payload (#487) |
| PWA emergency denylist | No cache for Code Blue / snapshot / realtime | **OK** — no SW changes in pilot bundle |
| Code Blue offline | Mutations never queued offline | **OK** — `api.codeBlue.sessions.*`; tests green |
| Strategy A authority | Legacy shift path retained | **OK** — no authority evaluator changes in pilot PRs |
| Telemetry | Bounded enums only | **OK** — no new free-form metrics in pilot PRs |
| `appointmentsPage.*` / table names | Copy-only "Tasks" rename | **OK** — docs use operator-facing "Tasks" where relevant |

---

## Merged PR timeline (#478 → #488)

Chronological merges on `main` during pilot readiness execution (Program Brain lock order). **CI on each PR was green before merge.**

| Step | PR | Merged (UTC) | Title / scope |
|------|-----|--------------|---------------|
| 1 | [#478](https://github.com/dboy3156/VetTrack/pull/478) | 2026-05-26 | Critical correctness: staging cancel, inventory job tx, Redis enqueue recovery |
| 2 | [#308](https://github.com/dboy3156/VetTrack/pull/308) | 2026-05-26 | P1: clinic-scope PO and alert-ack response reads |
| 3 | [#484](https://github.com/dboy3156/VetTrack/pull/484) | 2026-05-26 | CI: integration ops gate (`pnpm test:integration:ops`) |
| 4 | [#481](https://github.com/dboy3156/VetTrack/pull/481) | 2026-05-26 | JR-MIG wave 2: expiry + stale-checkin → `startJobRuntime()` |
| 5 | [#480](https://github.com/dboy3156/VetTrack/pull/480) | 2026-05-26 | OUTBOX-DLQ: admin list, retry, drop (clinic-scoped) |
| 6 | [#485](https://github.com/dboy3156/VetTrack/pull/485) | 2026-05-26 | STEP 6: Code Blue API client, realtime reconnect, sync lock |
| — | [#487](https://github.com/dboy3156/VetTrack/pull/487) | 2026-05-26 | Codex P1: peer cursor-zero reset guarded by `clinicId` |
| 7 | [#486](https://github.com/dboy3156/VetTrack/pull/486) | 2026-05-26 | STEP 7: `docs/pilot.md` runbook + `.env.example` |
| 8 | [#488](https://github.com/dboy3156/VetTrack/pull/488) | *pending* | STEP 8: `docs/pilot-step8-debug-pass.md` (docs-only) |
| 9 | *this report* | — | STEP 9: Go/No-Go + operator checklist (docs-only) |

Related offline hardening merged same window (not numbered in lock order): #472–#475, #479.

**Mainline SHA for deploy tag:** `d126e03b` (post-#486/#487). After #488–#489 merge, retag to latest `main` tip.

---

## Remaining BUG_REGISTER items

The register (`BUG_REGISTER.md`, dated 2026-05-21 on `staging`) remains the **backlog** for post-pilot hardening. Pilot execution **closed or mitigated** several P1 entries (see table above).

**Do not treat the register as blocking** if:

- CI is green on `main`
- STEP 8 found no new P0/P1 on current mainline
- Open IDs are P2/P3 or ops-only (SE-01)

**Post-pilot priority** (from register): CI allowlist alignment (AU-01/TI-01), `staging` branch CI (DP-03), clinic timezone for tasks (TZ-01), sync failure toast (EU-01), ER queue contract (CD-01).

---

## Pilot operational checklist (summary)

Full shift-level detail: **`docs/pilot-operator-checklist.md`**.

| Phase | Key actions |
|-------|-------------|
| Pre-deploy | `pnpm db:migrate` on target DB; Redis up; Clerk keys + `ALLOWED_ORIGIN`; run CI-equivalent checks on release commit |
| Pre-shift | Admin: ops dashboard outbox/DLQ green; ward display loads; test sign-in |
| During shift | Monitor DLQ and sync telemetry; Code Blue online-only; SSE reconnect self-heals |
| End of shift | DLQ empty or acknowledged; no stuck Code Blue session; sync queue drained |

---

## Rollback procedure

1. **Application:** Redeploy previous known-good Railway (or host) image/commit **before** pilot merge baseline (pre-#478) only if a P0 is confirmed in production. Prefer rolling forward with a hotfix PR on `main`.
2. **Database:** Migrations applied at startup are **forward-only** in normal ops. Rollback of schema requires a planned migration revert PR — do not delete production DB.
3. **Redis / queues:** Draining BullMQ queues may be required if job handlers changed (#481). Pause workers, redeploy, resume.
4. **Client / PWA:** Users may need hard refresh or SW update if frontend bundle regresses; emergency endpoints must never be served from stale cache (SW denylist unchanged).
5. **Feature flags:** `STALE_CHECKIN_SWEEP_ENABLED` can be set `false` to disable sweep without code rollback.
6. **Communication:** Declare incident channel; preserve `vt_audit_logs` and outbox DLQ rows for forensics.

---

## Go / No-Go decision

| Decision | **GO** |
|----------|--------|
| Scope | Mainline full-stack pilot at a **single clinic** (or isolated staging clinic mirroring prod config) |
| Rationale | Locked steps 1–7 merged; Codex P1 remediated; STEP 8 pass on tests/build/pilot-critical suites; frozen surfaces respected; operator docs complete |
| Conditions | (1) Production Redis + Postgres 16 + migrations applied, (2) Clerk production auth configured, (3) CI green on deploy commit, (4) SE-01 rotation verified by ops, (5) admin trained on DLQ + Code Blue offline doctrine |
| No-Go triggers | New P0 in production, CI red on `main`, failed migration on target DB, active unrecovered DLQ growth without operator action |

**STEP 10 (dry run):** Execute `docs/pilot-operator-checklist.md` on staging with real roles before first clinical shift on production.

---

## CI vs local environment (authoritative)

| Check | Authoritative | Local caveat |
|-------|---------------|--------------|
| Merge gate + unit tests | GitHub Actions on `main` | Agent `pnpm test` matches CI when `DATABASE_URL` is not pointed at a dirty DB |
| Integration ops | CI job: Postgres 16 + `pnpm migrate` + `pnpm test:integration:ops` | Local skip if schema behind (e.g. missing `custody_state`) |
| Playwright E2E | CI shards | Requires running app + Chromium; not re-run for this doc-only STEP |
| Migrations | CI fresh database | Local orphan rows can fail `065_core_table_fk_constraints.sql` |

**Rule:** If local results disagree with CI, **trust CI** and fix the local database or environment.

---

## Evidence references

- Runbook: `docs/pilot.md` (mainline section)
- Debug pass: `docs/pilot-step8-debug-pass.md`
- Operator checklist: `docs/pilot-operator-checklist.md`
- Engineering doctrine: `CLAUDE.md`, `README.md`
- Backlog: `BUG_REGISTER.md`
