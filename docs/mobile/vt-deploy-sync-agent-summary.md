# VetTrack — `.vt-deploy` sync handoff (agent summary)

**Created:** 2026-06-16  
**Branch:** `feat/clinical-design-system-refresh`  
**Repo:** `/Users/dan/vettrack`  
**Deploy source (Railway):** `/Users/dan/.vt-deploy` via `railway up --detach` (not CI)

**Human decision (2026-06-16):** Do **not** sync or deploy yet. This doc is for the next agent/human operator.

---

## Situation in one paragraph

Production is deployed manually from `/Users/dan/.vt-deploy`, which is **stale** (e.g. `server/index.ts` dated **Jun 12**). Live prod `/api/version` reports `builtAt: **2026-06-15T10:05**`. Current repo is **Jun 16**. Deploying from `.vt-deploy` as-is would **roll prod backward**. The only safe direction is **repo → `.vt-deploy`**, which ships ~**153 differing files** (+ **19** files only in `.vt-deploy` that repo removed) — roughly four days of drift, mostly UI/design-system and native-shell work, plus server/auth/CORS changes.

---

## Three-way timeline

| Snapshot | Date / signal | Role |
|----------|---------------|------|
| `.vt-deploy` | `server/index.ts` Jun 12 | Stale Railway upload source |
| Live prod | `/api/version` builtAt 2026-06-15T10:05 | What's running now |
| Repo (`feat/clinical-design-system-refresh`) | Jun 16 | Source of truth to sync forward |

---

## Delta scope (`.vt-deploy` vs repo)

| Area | Differing files (approx.) |
|------|---------------------------|
| `src/` | 78 |
| `server/` | 35 |
| `tests/` | 12 |
| Build configs + lockfile | 5 (`package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `tailwind.config.ts`, `tsconfig.json`) |

**Build-affecting package changes (repo ahead):**

- New scripts: `cap:build:native*`, `cap:install:ios-sim`
- New deps: `@capacitor/filesystem`, `@capacitor/share`, `html-to-image`
- Removed dead script: `sync:formulary`

**Migrations only in repo (run at server startup):**

- `153_dev_seed_hebrew_floor_notes.sql` — dev-clinic seed only
- `154_vt_equipment_name_he.sql` — `ALTER TABLE vt_equipment ADD COLUMN name_he` (**runs on prod**)

**Notable server/runtime changes in repo (not in `.vt-deploy`):**

- `server/index.ts`: `x-powered-by` disabled; `/api/version` after CORS; Capacitor CORS in dev; AASA route for Universal Links
- `server/middleware/auth.ts`: Clerk profile enrichment failure → **503** (was warn + continue); **removed** per-request `ADMIN_EMAILS` auto-promotion; `requireRole` export removed (unused)

---

## Review findings

### Bugbot (`feat/clinical-design-system-refresh` vs `main`)

| Severity | Location | Finding |
|----------|----------|---------|
| Medium | `src/components/ShiftShareCard.tsx:77-78` | PNG share card hardcodes English; no `dir="rtl"` for Hebrew-default users |

No other Bugbot blockers for deploy.

### Human sign-off still advised

1. **Auth hardening** — new users may get 503 during Clerk API blips (`AUTH_PROFILE_UNAVAILABLE`).
2. **Breadth** — 35 server files changed without line-by-line clinical review.
3. **Migration 154** — additive column; auto-applies on deploy.

---

## Local deploy gate (repo, 2026-06-16)

| Step | Result |
|------|--------|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm build` | PASS (Tailwind ambiguity warning + large chunks — non-blocking) |
| `pnpm test` | PASS — **337** files, **3356** tests (after mock fixes below) |

### Uncommitted test fixes (include in sync if not committed first)

- `tests/auth-guard-nfc-toast.test.tsx` — add `getStoredLocale` / `isSupportedLocale` to i18n mock
- `tests/offline-phase-5-sync-engine-state.test.ts` — add `getCurrentUserId` to auth-store mock
- `tests/sync-engine-replay-headers.test.ts` — same
- `tests/sync-tel-sync-engine-telemetry.test.ts` — same

---

## Agent constraints

- **Do not** `railway up` or sync `.vt-deploy` unless Dan explicitly asks in that message.
- **Do not** deploy from stale `.vt-deploy` without syncing repo forward first.
- **Do not** commit unless asked.
- Native iOS ship gate: `docs/mobile/native-ship-checklist.md` (separate from Railway backend deploy).
- Railway MCP token may be expired; use **CLI** from a plain directory (see `RESUBMISSION_RUNBOOK.md`).

---

## Recommended sync commands

Run from repo after Dan approves sync. **Dry-run first.**

### 1. Pre-flight (repo)

```bash
cd /Users/dan/vettrack
pnpm install --frozen-lockfile && pnpm build && pnpm test
```

### 2. Dry-run — see what would change

```bash
rsync -avn --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude .env \
  --exclude .env.local \
  --exclude .env.local.archiving \
  --exclude .pnpm-store \
  --exclude ios \
  --exclude android \
  --exclude docs \
  --exclude .DS_Store \
  --exclude build \
  --exclude logs \
  /Users/dan/vettrack/ /Users/dan/.vt-deploy/
```

Review output. Expect ~150+ file updates; confirm no accidental deletion of Railway-only secrets under `.vt-deploy` (env is excluded).

### 3. Sync repo → `.vt-deploy`

```bash
rsync -av --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude .env \
  --exclude .env.local \
  --exclude .env.local.archiving \
  --exclude .pnpm-store \
  --exclude ios \
  --exclude android \
  --exclude docs \
  --exclude .DS_Store \
  --exclude build \
  --exclude logs \
  /Users/dan/vettrack/ /Users/dan/.vt-deploy/
```

### 4. Deploy (human-only unless explicitly commanded)

```bash
cd /Users/dan/.vt-deploy
railway up --detach
```

Do **not** pass `.` as a path argument to `railway up` on CLI 5.5.0 (prefix error). Run from inside `.vt-deploy`.

### 5. Post-deploy verification

```bash
curl -sS https://vettrack.uk/api/version | python3 -m json.tool
```

Confirm `builtAt` is **newer than** `2026-06-15T10:05:00.000Z`.

Optional:

```bash
./scripts/verify-resubmission.sh
```

---

## Related docs

- `docs/mobile/native-ship-checklist.md` — Capacitor TestFlight gate
- `docs/mobile/native-ship-master-prompt.md` — agent/human split for native ship
- `RESUBMISSION_RUNBOOK.md` — demo login, Clerk, Railway CLI notes
