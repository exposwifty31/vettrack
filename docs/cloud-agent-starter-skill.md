# Cloud Agent Starter Skill (VetTrack)

This is the minimal, practical runbook Cloud agents should use first when working in this repo.

## 1) Fast bootstrap (first 5 minutes)

### Prereqs
- Node `>=22.12.0` (repo targets `22.14.0`)
- `pnpm` `9.15.9`
- PostgreSQL 16

### Install + database
```bash
pnpm install
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "CREATE USER vettrack WITH PASSWORD 'vettrack';" || true
sudo -u postgres psql -c "CREATE DATABASE vettrack OWNER vettrack;" || true
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack npx tsx -e "const { runMigrations } = require('./server/migrate.ts'); runMigrations().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });"
```

### Start app (API + web)
```bash
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack \
SESSION_SECRET=dev-session-secret-for-local-development \
NODE_ENV=development \
PORT=3001 \
pnpm dev
```

Notes:
- `PORT=3001` is required so Vite proxy (`:5000 -> :3001`) works.
- `predev` kills stale `3001/5000` processes automatically.

---

## 2) Login/auth modes agents should use

### A. Default dev bypass (fastest; recommended for most code changes)
Use `NODE_ENV=development` and do **not** set `CLERK_SECRET_KEY`.

Behavior:
- Backend auth middleware injects a local admin user.
- UI login page shows fallback ("Continue to Dashboard").
- `/api/users/me` returns `200` without Clerk session.

Quick verify:
```bash
curl -i http://localhost:5000/api/users/me
```

### B. Simulate different users/roles without Clerk
For API tests, override dev identity via headers:

```bash
curl -s http://localhost:5000/api/users/me \
  -H "x-dev-role-override: technician" \
  -H "x-dev-user-id-override: dev-user-alpha"
```

Supported presets in code:
- `dev-user-alpha`
- `dev-user-beta`

Role override options:
- `admin`, `vet`, `technician`, `viewer`

### C. Real Clerk flow (only when task explicitly needs it)
- Requires valid Clerk keys and interactive login.
- Production keys reject plain `http://localhost` origin; use HTTPS proxy flow from `AGENTS.md` when necessary.
- For automated signup E2E, `sk_test_` keys are required by Playwright setup.

---

## 3) Feature flags / runtime toggles / mocks

This codebase has few classic feature flags; use these practical toggles:

- `CLERK_ENABLED=false`: disables Clerk middleware even if secret exists.
- Omit `CLERK_SECRET_KEY` in `NODE_ENV=development`: enables dev auth bypass.
- Stability dashboard "Testing Mode" (`/stability`) acts as a safe CRUD test toggle.
- `x-dev-role-override` + `x-dev-user-id-override` headers: mock auth personas for backend tests.

---

## 4) Testing workflows by codebase area

### Area: Backend API + DB (`server/**`, `migrations/**`)

### Smoke workflow
1. Start app in dev bypass mode.
2. Check health:
   ```bash
   curl -i http://localhost:3001/api/healthz
   ```
3. Check auth + role path:
   ```bash
   curl -i http://localhost:5000/api/users/me
   curl -i http://localhost:5000/api/users/me -H "x-dev-role-override: viewer"
   ```
4. Run route registration/unit-style tests:
   ```bash
   pnpm test
   ```

### When editing schema/migrations
1. Re-run migrations command.
2. Re-run `pnpm test`.
3. Validate high-risk endpoints manually (equipment + users + analytics) with `curl`.

---

### Area: Frontend UI + routing (`src/pages/**`, `src/components/**`)

### Smoke workflow
1. Start dev server.
2. Open app at `http://localhost:5000`.
3. In dev bypass mode:
   - go to `/signin` and continue to dashboard
   - verify changed page/flow
4. Confirm API-backed screens load (Dashboard, Equipment, Analytics) with no console/server errors.

### Regression workflow
- Run full test script:
  ```bash
  pnpm test
  ```
- If change impacts auth journey, run signup E2E (requires Clerk test keys):
  ```bash
  pnpm test:signup
  ```

---

### Area: Offline/PWA + sync (`src/lib/offline-db.ts`, `src/lib/sync-engine.ts`, SW)

### Fast checks
1. Run:
   ```bash
   pnpm test
   ```
   (includes offline/conflict/PWA system tests + Phase 9 deterministic drills)
2. In browser DevTools, toggle offline and verify app shell still loads.
3. Trigger an action offline (for example, equipment status change), then reconnect and confirm sync completion.
4. **Do not** add Code Blue mutation endpoints (`POST /code-blue/sessions`, `POST /code-blue/sessions/:id/logs`, `PATCH /code-blue/sessions/:id/end`, `PATCH /code-blue/sessions/:id/presence`) to the offline queue. The classifier in `src/lib/offline-emergency-block.ts` fails them loud and increments a bounded counter — this is required behavior.
5. **Do not** add emergency endpoints (`/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/*`) to any Cache Storage path in `public/sw.js`. They are on an unconditional bypass denylist.

### Area: Realtime / Code Blue (`server/routes/realtime.ts`, `src/lib/realtime.ts`, `public/sw.js`)

Transport is SSE — `/api/realtime/stream`, outbox-backed ordering on `vt_event_outbox`. Reconnect uses `Last-Event-ID` replay; pruned cursors trigger a snapshot resync. `KEEPALIVE` events carry `{ activeCodeBlueSessionId, stormHint }` and never invalidate caches. Cross-tab uses `BroadcastChannel("vt_realtime_outbox_cursor")` with a versioned envelope (`cursor`, `build_tag`, `code_blue_seen`).

When verifying realtime/PWA changes:
- Unit-level: `tests/phase-9-deterministic-drills.test.ts` (bounded-counter contracts).
- Browser-level: `tests/phase-9-drills.spec.ts` (8 Playwright drills covering replay-gap, stale SW, BFCache, storm, split-version, degraded mode, stale emergency cache, offline emergency block).
- Telemetry surfaces are bounded enums in `server/routes/realtime.ts` — adding a new metric series requires extending the enum + the closed `incrementMetric()` union.

---

### Area: Stability runner (`/stability`, `server/lib/test-runner.ts`)

### Practical workflow
1. Log in as admin (dev bypass already admin).
2. Visit `/stability`.
3. Run Functional + Stress + Edge test suite from the UI.
4. Enable "Testing Mode" only when CRUD test data creation is intended.
5. Confirm logs/results refresh and no stuck "running" state.

Why this matters:
- Stability routes use internal token + admin checks and are the fastest full-stack regression signal for API health/perf.

---

### Area: Auth + signup E2E (`tests/signup-flow.spec.ts`)

Use when editing:
- `server/middleware/auth.ts`
- Clerk integration paths
- signup/signin pages

Command:
```bash
TEST_BASE_URL=http://localhost:5000 \
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack \
pnpm test:signup
```

Notes:
- In pure dev bypass mode (no Clerk key), parts of Clerk-specific flow are skipped by test logic.
- Full Clerk path requires `CLERK_SECRET_KEY` with `sk_test_` prefix.

---

## 5) Common Cloud-agent workflow shortcuts

- Typecheck quickly:
  ```bash
  npx tsc --noEmit
  ```
- Production build sanity check:
  ```bash
  pnpm build
  ```
- If auth/CORS behavior seems wrong, confirm env first (`PORT`, `NODE_ENV`, `ALLOWED_ORIGIN`, Clerk vars).

---

## 6) Keeping this skill updated (lightweight process)

When a new testing trick/runbook fix is discovered:
1. Add it to the relevant "Area" section above (not a random notes dump).
2. Include one reproducible command/snippet.
3. Mark whether it is:
   - default path (safe for all agents), or
   - task-specific path (only for auth/prod-like/E2E work).
4. If it replaces an older step, remove the old step in the same change.

Goal: this file should stay short, executable, and biased toward fastest reliable agent workflows.
