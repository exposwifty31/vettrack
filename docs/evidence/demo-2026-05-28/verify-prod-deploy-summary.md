# verify-prod-deploy — 2026-05-27

## Final run (post-#508 deploy)

**Command:** `npx tsx scripts/verify-prod-deploy.ts ba364b32 --timeout 10`  
**Exit:** 0  
**Production `gitCommit`:** `ba364b32`

| Probe | Result |
|-------|--------|
| pilotMode backend/frontend false, mismatch false | PASS |
| /api/appointments | 401 JSON |
| /api/medication-tasks | 401 JSON |
| /api/billing | 401 JSON |
| /api/tasks/dashboard | 401 JSON |
| /api/shift-handover/summary | 401 JSON |
| /api/clinical/me/active | 401 JSON |
| /api/health worker | **PASS ok** |

## Earlier run (pre-#508 Worker deploy)

**Command:** `npx tsx scripts/verify-prod-deploy.ts 18ea8777 --timeout 30`  
**Exit:** 0 (probes pass; worker WARN)

| Probe | Result |
|-------|--------|
| pilotMode | PASS |
| API JSON 401 probes | PASS |
| /api/health worker | WARN fail — fixed after #508 + Railway Worker deploy |
