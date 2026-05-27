# Railway production redeploy runbook (founder reference)

Cursor executed FIX-1 on 2026-05-27. Use this for future deploys without the agent.

## Project

- **Project:** pacific-flow (`adf88531-75ce-41a8-9f9f-b27e88c87772`)
- **Services:** `VetTrack` (API + static), `Worker` (BullMQ + same `pnpm start` stack)
- **Production URL:** https://vettrack.uk

## Pre-flight

```bash
export PATH="$HOME/.railway/bin:$PATH"
railway link -p adf88531-75ce-41a8-9f9f-b27e88c87772 -s VetTrack -e production
railway variables --service VetTrack --json | jq 'keys'
railway deployment list --service VetTrack --json | jq '.[0]'
tsx scripts/verify-prod-deploy.ts $(git rev-parse HEAD | head -c 8) --timeout 5
```

Snapshot variable **keys** before deleting anything (`docs/evidence/demo-2026-05-28/railway-preflight/`).

## Mainline pilot cleanup

Full platform requires **no** equipment-only pilot override:

```bash
railway variable delete VITE_PILOT_MODE --service VetTrack
railway variable delete PILOT_MODE --service VetTrack   # if present
```

Build already forces `VITE_PILOT_MODE=false` in `railway.json` / Dockerfile; removing the service var avoids confusion.

## Deploy

```bash
git checkout main && git pull
railway redeploy --service VetTrack
railway redeploy --service Worker   # after worker-heartbeat or queue changes (#508)
```

## Verify

```bash
tsx scripts/verify-prod-deploy.ts $(git rev-parse origin/main | head -c 8) --timeout 600
```

Expect:

- `gitCommit` matches `main`
- `pilotMode.backend/frontend === false`, `mismatch === false`
- API subpaths return **401** + `application/json` (not SPA HTML)
- `/api/health` → `worker: ok` after Worker redeploy with #508

## Rollback

```bash
railway redeploy --deployment <id-from-deploy-snapshot.json>
```

See `docs/demo-rollback.md`.
