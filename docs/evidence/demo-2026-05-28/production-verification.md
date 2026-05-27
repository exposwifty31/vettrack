# Production verification — demo 2026-05-28

**Generated:** 2026-05-27T17:49:48Z UTC (probes re-run after Codex review)  
**Target:** https://vettrack.uk  
**Agent commit on main:** `aa688d81` (includes #497, #502, #503, #501)

## Codex review (addressed)

Bare `GET /api/{mount}` paths without a registered handler return **SPA `index.html`** (`content-type: text/html`) via the catch-all in `server/index.ts`. A **200 + HTML** response is **not** a passing API smoke. Probes below use **real subpaths** and require `content-type: application/json`.

## API probes

### `/api/version` and health

```
$ curl -sS https://vettrack.uk/api/version | jq .
{
  "version": "1.1.2",
  "buildTag": "1.1.2-mpocavdu",
  "gitCommit": "bf096c419c11aa8839c3fcc4653506f32c2bf4e3",
  "builtAt": "2026-05-27T17:30:36.656Z",
  "pilotMode": {
    "backend": false,
    "frontend": false,
    "mismatch": false
  }
}

$ curl -sS https://vettrack.uk/api/health | jq .
{
  "status": "degraded",
  "type": "readiness",
  "checks": { "db": "ok", "clerk": "ok", "vapid": "ok", "worker": "fail" }
}

$ curl -sS https://vettrack.uk/api/healthz
ok
```

### Unauthenticated JSON API (expect HTTP 401 + `application/json`)

| Path | Status | Content-Type | Valid API? |
|------|--------|--------------|------------|
| `/api/appointments` | 401 | application/json | Yes |
| `/api/medication-tasks` | 401 | application/json | Yes |
| `/api/billing` | 401 | application/json | Yes |
| `/api/patients` | 401 | application/json | Yes |
| `/api/inventory-items` | 401 | application/json | Yes |
| `/api/procurement` | 401 | application/json | Yes |
| `/api/dispense` | 401 | application/json | Yes |
| `/api/tasks/dashboard` | 401 | application/json | Yes |
| `/api/tasks/me` | 401 | application/json | Yes |
| `/api/shift-handover/summary` | 401 | application/json | Yes |
| `/api/shift-handover/patients` | 401 | application/json | Yes |
| `/api/clinical/me/active` | 401 | application/json | Yes (mount is `/api/clinical`, not `/api/clinical-check-in`) |

### SPA false positives (do **not** use for API smoke)

| Path | Status | Content-Type | Notes |
|------|--------|--------------|-------|
| `/api/tasks` | 200 | text/html | No bare `GET` on mount — use `/api/tasks/*` |
| `/api/shift-handover` | 200 | text/html | Use `/api/shift-handover/summary`, etc. |
| `/api/clinical-check-in` | 200 | text/html | Wrong mount; app uses `/api/clinical` |
| `/api/clinical-check-in/me/active` | 200 | text/html | Wrong path |

## Assessment

| Gate | Status | Notes |
|------|--------|-------|
| `pilotMode.*` false, no mismatch | **PASS** | Full platform routes active |
| Core APIs return JSON 401 (not SPA HTML) | **PASS** | After probing real subpaths only (see table) |
| `/api/health` DB + Clerk | **PASS** | |
| `/api/health` worker | **WARN** | `worker: fail` — confirm Redis/workers on Railway after redeploy |
| Deploy SHA vs main | **PENDING** | Production `gitCommit` is `bf096c41` (#497); redeploy needed for latest `main` |

## Post-redeploy checklist

1. Railway production: remove `PILOT_MODE` and `VITE_PILOT_MODE` service variables if still set.
2. Trigger deploy from latest `main`.
3. Re-run probes; expect `gitCommit` ≥ post-#501 merge.
4. Signed-in Playwright smoke: `/home` full nav, `/admin/ops-dashboard`, equipment list (screenshots in PR-8 when complete).

## Rollback

See `docs/demo-rollback.md`.
