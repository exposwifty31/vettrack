# Pilot STEP 10 — Staging dry-run report

**Report version:** 2 (Program Brain DR-01 remediation pass)  
**Date:** 2026-05-26  
**Environment:** **Staging only** — `https://vettrack-staging.up.railway.app`  
**Production:** No mutations, no production deploys, no schema changes  
**Deploy candidate (mainline):** `d126e03b` — package **`1.1.2`** on `main` (post-#486/#487; #489/#490 docs pending merge)  
**CI authority:** GitHub Actions on `main` is **authoritative**. Staging probes and Vitest contracts are supplemental only.

---

## Executive summary

| Layer | Result |
|-------|--------|
| Staging infrastructure probe | **PASS** — health, startup, DB, Redis, Clerk |
| Deploy candidate alignment (DR-01) | **FAIL / BLOCKING** — staging still `1.1.1`; mainline `1.1.2` |
| Contract / failure-injection (mainline workspace) | **PASS** — 83 Vitest tests |
| Human staging walkthrough | **NOT COMPLETE** — blocked on DR-01 + staging E2E secrets |

**Program Brain gate:** STEP 10 is **not final pilot evidence** until DR-01 is closed and the [human walkthrough](#human-staging-walkthrough-post-dr-01) is recorded below.

| Final statement (this revision) | Status |
|---------------------------------|--------|
| Pilot **code/docs on `main`** | Ready per STEP 9 (**GO with conditions**) |
| Pilot **deploy candidate validated on staging** | **NOT READY** — DR-01 open |
| Merge **#490** as final STEP 10 sign-off | **Hold** until DR-01 + walkthrough sections are filled |

---

## DR-01 — Required action (blocking)

### Problem

| Source | Version / SHA |
|--------|----------------|
| `GET /api/version` (staging, 2026-05-26) | **`1.1.1`** |
| `main` `package.json` (deploy candidate) | **`1.1.2`** @ **`d126e03b`** |

A dry run on **`1.1.1`** proves “staging worked,” not “**pilot candidate** worked.” STEP 6–#487 fixes (Code Blue client, realtime reconnect, clinic-scoped cursor gossip) may be absent on the running host.

### Acceptance criteria (Program Brain)

1. Redeploy staging from current **`main`** (≥ `d126e03b`, or tip after #489/#490 merge).
2. `GET /api/version` → **`{"version":"1.1.2"}`** (or newer if package bumped).
3. Complete [human staging walkthrough](#human-staging-walkthrough-post-dr-01).
4. Update this document with deployed SHA, walkthrough pass/fail, and [final GO](#final-go-statement).

### Remediation attempts (Cursor agent, 2026-05-26)

| Action | Result |
|--------|--------|
| Re-probe `GET /api/version` | Still **`1.1.1`** |
| `railway up` with `RAILWAY_TOKEN_STAGING` + `RAILWAY_SERVICE_STAGING` | **Failed** — invalid token in cloud agent context |
| `railway up` with `RAILWAY_TOKEN` | **Failed** — invalid token |
| `git merge origin/main` → `staging` branch | **Aborted** — multiple merge conflicts; out of scope for docs-only STEP |
| `gh workflow run staging-e2e-manual.yml` | **403** — workflow dispatch not permitted for this integration |

**Conclusion:** Redeploy and authenticated walkthrough require **human ops** (Railway dashboard or valid CLI token + staging secrets). Agent cannot close DR-01 from this environment.

### Ops runbook — redeploy staging to mainline (human)

Pick **one** path (coordinate with platform owner):

**Path A — Railway (recommended if staging service tracks `main`)**

1. Railway → **staging** VetTrack service → **Settings** → confirm deploy branch / source is **`main`** at commit **`d126e03b`** (or latest green `main`).
2. **Deploy** → wait for **SUCCESS**.
3. Verify:
   ```bash
   curl -sS https://vettrack-staging.up.railway.app/api/version
   # Expected: {"version":"1.1.2"}
   ```

**Path B — Git `staging` branch (if Railway tracks `staging`)**

1. Resolve merge of `main` → `staging` (conflicts in `package.json`, locales, `server/db.ts`, etc.) **or** reset staging to `main` per team policy.
2. Push; wait for Railway **SUCCESS**.
3. Same `curl` version check as Path A.

**Path C — CLI (operator machine with valid token)**

```bash
git checkout main && git pull
export RAILWAY_TOKEN='<valid-staging-token>'
export RAILWAY_SERVICE='<staging-service-id>'
# Satisfy deploy.sh preflight env (staging DATABASE_URL, Redis, Clerk, etc.)
bash deploy.sh
```

See `docs/release-runbook.md` §1.3 and `docs/staging-e2e-runbook.md`.

---

## Deployment SHA (current vs target)

| Field | Value |
|-------|--------|
| **Target git SHA** | `d126e03b` (or `main` tip after doc merges) |
| **Target app version** | `1.1.2` |
| **Staging observed version** | `1.1.1` (last probe: 2026-05-26) |
| **Staging git SHA** | Unknown — not exposed via public API; use Railway deployment metadata |
| **DR-01** | **OPEN** |

### Post-redeploy verification log

*Fill this section after ops redeploy.*

| Check | Expected | Actual | Pass? |
|-------|----------|--------|-------|
| `GET /api/version` | `1.1.2` | *pending* | *pending* |
| Railway deploy status | SUCCESS | *pending* | *pending* |
| Deploy commit | ≥ `d126e03b` | *pending* | *pending* |

---

## Environment used

| Item | Value |
|------|--------|
| Base URL | `https://vettrack-staging.up.railway.app` |
| Node env (startup) | `production` |
| Database / Redis / Clerk (startup) | All reported configured and DB reachable |
| Agent session | Unauthenticated HTTP probes only |

---

## Dry-run execution checklist

Legend: **Probe** · **Sim** (Vitest on mainline workspace) · **Human** (staging auth)

| # | Step | Status | Evidence |
|---|------|--------|----------|
| 1 | Login | **Human — pending** | `401` without session; run after DR-01 + `pnpm staging:seed` |
| 2 | Equipment checkout | **Human — pending** | `pnpm test:staging:walkthrough` |
| 3 | Offline mode | **Sim PASS** | `offline.test.js`, `offline-phase-5-sync-engine-state.test.ts` |
| 4 | Sync recovery | **Sim PASS** | `offline-phase-5-sync-engine-state.test.ts`, `pwa.system.test.js` |
| 5 | Code Blue start/end | **Sim PASS**; **Human pending** | `code-blue-offline-queue-removed.test.ts`; staging Playwright not run |
| 6 | DLQ retry/drop | **Sim PASS**; **Human pending** | `admin-outbox-dlq-api.test.ts`; UI after login |
| 7 | Shift completion | **Human — pending** | `docs/pilot-operator-checklist.md` end-of-shift |
| 8 | Metrics validation | **Probe PASS**; **Human pending** | Startup health OK; ops dashboard after login |

---

## Human staging walkthrough (post DR-01)

*Record results after staging serves **`1.1.2`** and walkthrough is executed.*

**Command (from `docs/staging-e2e-runbook.md`):**

```bash
export STAGING_E2E_CONFIRM=yes
export STAGING_E2E_PASSWORD='...'          # staging secret
export DATABASE_URL='...'                  # staging DB only
export CLERK_SECRET_KEY='sk_test_...'
export VITE_CLERK_PUBLISHABLE_KEY='pk_test_...'
export TEST_BASE_URL='https://vettrack-staging.up.railway.app'

pnpm staging:seed
pnpm test:staging:e2e
pnpm test:staging:walkthrough
pnpm staging:cleanup   # or STAGING_E2E_AUTO_CLEANUP=yes
```

**Alternative:** Manual execution of `docs/pilot-operator-checklist.md` on staging with clinic champion.

### Walkthrough result log

| Flow | Result | Notes |
|------|--------|-------|
| Login (admin) | *pending* | |
| Equipment checkout/return | *pending* | |
| Offline → reconnect → sync | *pending* | |
| Code Blue start / log / end | *pending* | Online only |
| DLQ list / retry / drop (test row) | *pending* | |
| Shift end validation | *pending* | |
| Ops dashboard metrics | *pending* | |

**Overall walkthrough:** *pending*

---

## Workflow validation (contract level — mainline)

These ran on the **mainline workspace** (deploy candidate source), not on staging `1.1.1`.

| Area | Result |
|------|--------|
| Offline / emergency block | **PASS** — 54 tests |
| Code Blue offline block | **PASS** |
| DLQ admin API contracts | **PASS** |
| Peer cursor clinic guard (#487) | **PASS** |
| PWA system | **PASS** |

---

## Failure injection results

Simulated in Vitest only — no staging tenant data modified.

| Injection | Suite | Result |
|-----------|-------|--------|
| Offline Code Blue | `code-blue-offline-queue-removed` | PASS |
| Emergency classifier | `offline-emergency-block` | PASS |
| Sync circuit / retries | `offline-phase-5-sync-engine-state` | PASS |
| Cross-clinic cursor `0` | `peer-cursor-prune-clinic-guard` | PASS |
| DLQ tenancy | `admin-outbox-dlq-api` | PASS |

---

## Observed issues

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| **DR-01** | **BLOCKING** | Staging `1.1.1` ≠ mainline `1.1.2` | **Ops redeploy required** — see [DR-01](#dr-01--required-action-blocking) |
| DR-02 | **BLOCKING** (for final STEP 10) | Human walkthrough not executed | Complete after DR-01 |
| DR-03 | P2 (known) | Sync permanent-failure toast (EU-01) | Accepted for pilot |
| DR-04 | P2 (known) | Allowlisted i18n debt | Accepted |
| DR-05 | — | Staging infra unhealthy | Not observed |

---

## CI vs staging vs local

| Signal | Authoritative? |
|--------|----------------|
| CI merge gate on deploy commit | **Yes** |
| Staging `/api/version` match | **Required** for STEP 10 final sign-off |
| Local Vitest (this agent) | Supplemental |
| Local DB / integration skip | **Not** a CI failure |

---

## Final GO statement

| Audience | Decision |
|----------|----------|
| **Mainline code + docs (STEPS 1–9)** | **GO with conditions** — per `docs/pilot-go-no-go-report.md` |
| **Staging deploy candidate validated (STEP 10 final)** | **NO-GO until DR-01 closed** and human walkthrough logged above |
| **Program Brain pilot readiness %** | **~97%** — operational validation only (deployment + walkthrough) |

**After DR-01 + walkthrough:** Update this section to **GO for pilot rehearsal on staging** and **GO for production pilot** only when Program Brain accepts evidence and production deploy uses the same commit as validated staging.

---

## Related documents

- `docs/pilot-operator-checklist.md`
- `docs/pilot-go-no-go-report.md`
- `docs/pilot.md`
- `docs/pilot-step8-debug-pass.md`
- `docs/staging-e2e-runbook.md`
- `docs/release-runbook.md`
