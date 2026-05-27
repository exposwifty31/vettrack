# PR-1 — Pilot mode production unblock

**Merged:** #497 (`bf096c41`)  
**Follow-ups merged:** #502 (automation log gating), #503 (vite `.env` load order)

## CI (#497)

All required checks green at merge (Tests & typecheck, Integration ops, Playwright shards 1–2, Merge gate).

## Production probes (2026-05-27)

| Probe | Result |
|-------|--------|
| `GET /api/version` → `pilotMode.backend=false` | PASS |
| `pilotMode.frontend=false` | PASS |
| `pilotMode.mismatch=false` | PASS |
| `GET /api/appointments` (JSON) | HTTP 401 |
| `GET /api/medication-tasks` | HTTP 401 |
| `GET /api/billing` | HTTP 401 |

## Railway redeploy

**Action required:** Production build still reports `gitCommit: bf096c41`. After removing stale `VITE_PILOT_MODE` / `PILOT_MODE` Railway variables, redeploy from `main` through `aa688d81` or later.

## Browser smoke (deferred)

Full signed-in screenshots (`/home`, topbar, `/admin/ops-dashboard`) require interactive Clerk sign-in — see PR-8 evidence package.
