# Demo workflow smoke — 2026-05-28

**Status:** FIX-3 blocked on staging credentials (2026-05-27)

| Workflow | Screenshots | Status |
|----------|-------------|--------|
| 8.1 Equipment scan / checkout / return | `screenshots/equipment-scan/` | **BLOCKED** — needs `STAGING_E2E_PASSWORD` + `sk_test_` Clerk |
| 8.2 Waitlist promotion | `screenshots/waitlist/` | **BLOCKED** — same; #501 merged on main |
| 8.3 RFID doorway | `screenshots/rfid/` | Nice-to-have |
| 8.4 Ops dashboard + DLQ | `screenshots/ops-dashboard/` | **BLOCKED** — staging admin path |
| 8.5 Realtime SSE | `screenshots/realtime-sse/` | Nice-to-have |
| 8.6 PWA offline | `screenshots/pwa-offline/` | Nice-to-have |

**Unblock:** Set `STAGING_E2E_PASSWORD`, `CLERK_SECRET_KEY=sk_test_*`, `VITE_CLERK_PUBLISHABLE_KEY=pk_test_*`, then:

```bash
pnpm staging:seed
TEST_BASE_URL=https://vettrack-staging.up.railway.app pnpm test:staging:walkthrough
pnpm staging:cleanup
```

**Minimum demo GO (plan):** 8.1, 8.2, 8.4 screenshotted on staging.
