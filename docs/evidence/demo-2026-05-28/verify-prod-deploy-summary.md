# verify-prod-deploy — 2026-05-27

**Command:** `npx tsx scripts/verify-prod-deploy.ts 18ea8777 --timeout 30`  
**Exit:** 0  
**Production `gitCommit`:** `18ea8777` (matches target)

| Probe | Result |
|-------|--------|
| pilotMode backend/frontend false, mismatch false | PASS |
| /api/appointments | 401 JSON |
| /api/medication-tasks | 401 JSON |
| /api/billing | 401 JSON |
| /api/tasks/dashboard | 401 JSON |
| /api/shift-handover/summary | 401 JSON |
| /api/clinical/me/active | 401 JSON |
| /api/health worker | **WARN fail** — pending Worker redeploy with #508 |
