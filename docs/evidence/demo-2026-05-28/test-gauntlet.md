# Test gauntlet — demo 2026-05-28
Generated: 2026-05-27T17:49:12Z UTC
Git: aa688d81

## A — tsc
```
$ npx tsc --noEmit
EXIT: 0
```
**Result:** PASS

## B — server tsc
```
$ pnpm exec tsc --noEmit -p tsconfig.server-check.json
EXIT: 0
```
**Result:** PASS

## E — i18n:check
```
$ pnpm i18n:check
EXIT: 0

> vettrack@1.1.2 i18n:check /workspace
> tsx scripts/i18n/check-parity.ts

✓ locales/en.json and locales/he.json are in deep key parity.
```
**Result:** PASS

## C — vitest (pnpm test)
```
$ DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack pnpm test
EXIT: 0

 Test Files  323 passed (323)
      Tests  4153 passed (4153)
   Duration  47.92s
```
**Result:** PASS (requires `pnpm db:migrate` on PostgreSQL 16 first)

## G — integration ops
```
$ DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack pnpm test:integration:ops
EXIT: 0

 Test Files  2 passed (2)
      Tests  61 passed (61)
```
**Result:** PASS

## D — production build
```
$ pnpm build
EXIT: 0
dist/public/assets/purify.es-CovBOfck.js                         22.58 kB │ gzip:   8.67 kB │ map:    93.54 kB
dist/public/assets/admin-ops-dashboard-js3iLfg2.js               24.78 kB │ gzip:   6.57 kB │ map:    69.54 kB
dist/public/assets/meds-3DRJUItA.js                              25.34 kB │ gzip:   7.31 kB │ map:    74.76 kB
dist/public/assets/patient-detail-CNrApXLg.js                    30.21 kB │ gzip:   7.79 kB │ map:    80.42 kB
dist/public/assets/pharmacy-forecast-CLVAvaJR.js                 30.90 kB │ gzip:   9.14 kB │ map:   104.89 kB
dist/public/assets/appointments-BR5za9p5.js                      41.51 kB │ gzip:   9.42 kB │ map:   127.19 kB
dist/public/assets/er-command-center-B4ek6dep.js                 42.71 kB │ gzip:  12.44 kB │ map:   134.55 kB
dist/public/assets/useRealtime-dMQzOEXg.js                       43.00 kB │ gzip:   9.91 kB │ map:   128.72 kB
dist/public/assets/equipment-list-Dvjp3-hs.js                    48.02 kB │ gzip:  15.01 kB │ map:   159.74 kB
dist/public/assets/shift-handover-page-CyzxeCYQ.js               50.29 kB │ gzip:  11.90 kB │ map:   148.78 kB
dist/public/assets/equipment-detail-B0uNDKKJ.js                  50.67 kB │ gzip:  12.99 kB │ map:   163.90 kB
dist/public/assets/admin-CVw3dIO9.js                             51.51 kB │ gzip:  10.72 kB │ map:   150.46 kB
dist/public/assets/new-equipment-BCY6DefG.js                     94.15 kB │ gzip:  25.72 kB │ map:   431.52 kB
dist/public/assets/index.es-GIe704b5.js                         158.84 kB │ gzip:  53.04 kB │ map:   649.63 kB
dist/public/assets/html2canvas.esm-DXEQVQnt.js                  201.04 kB │ gzip:  47.43 kB │ map:   602.76 kB
dist/public/assets/layout-CYzb0fWY.js                           492.03 kB │ gzip: 145.52 kB │ map: 2,332.79 kB
dist/public/assets/vendor-charts-DhRXlK7l.js                    552.57 kB │ gzip: 157.28 kB │ map: 2,115.20 kB
dist/public/assets/vendor-export-Q0UETJ-m.js                    672.40 kB │ gzip: 221.73 kB │ map: 2,727.00 kB
dist/public/assets/index-DRcCYV4a.js                            751.87 kB │ gzip: 230.43 kB │ map: 2,238.84 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 11.36s
```
**Result:** PASS

## F — validate:prod
```
$ pnpm validate:prod
EXIT: 1

> vettrack@1.1.2 validate:prod /workspace
> tsx scripts/validate-prod.ts

🔍 Running pre-deploy validation...

   Starting server on port 19871 for health check...

============================================================
  PRE-DEPLOY VALIDATION REPORT
============================================================
❌ [FAIL] Environment Variables
       Missing: SESSION_SECRET
✅ [PASS] Secret Scan
       No hardcoded secrets detected in source tree
✅ [PASS] Frontend Build
       ✅ Frontend build passed — 275 file(s) in dist/public.
❌ [FAIL] Runtime Health Check
       Server did not become ready on port 19871 (exited with code 1). Last output: ⚠️  CLERK_WEBHOOK_SECRET is recommended in production but is missing or empty

❌ FATAL: Production environment validation failed:

  - REDIS_URL is required in production but is missing or empty
  - SESSION_SECRET is required in production but is missing or empty
  - ALLOWED_ORIGIN is required in production but is missing or empty
  - DB_CONFIG_ENCRYPTION_KEY is required in production but is missing or empty

Fix the above issues before starting the application in production.
============================================================
❌ 2 CHECK(S) FAILED — fix the above issues before deploying.

 ELIFECYCLE  Command failed with exit code 1.
```
**Result:** FAIL (expected in cloud dev without production env vars; Railway sets these at deploy)

## CI reference (authoritative)

| Check | Main @ `aa688d81` |
|-------|-------------------|
| Vitest + typecheck | Green on merge of #502, #503 |
| Integration ops | Green |
| Playwright shards | Green |

## Deferred gauntlet (local supplement)

See **`test-gauntlet-deferred.md`** for 2026-05-27 cloud-agent runs:

| ID | Result | Notes |
|----|--------|-------|
| H | PASS | `tsx tests/restock.service.test.ts` |
| I | N/A | migration script-only |
| J | PASS | `pnpm test:db-integration` (54 tests) |
| K | Deferred | needs `pnpm dev` + Redis |
| L–P | CI authoritative | Playwright green on main CI |

## Original deferral note

| ID | Command | Reason |
|----|---------|--------|
| K | live-server vitest | Run with `pnpm dev` + Redis |
| L–P | Playwright | Full local proof optional when CI green |

