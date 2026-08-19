---
name: dev-to-prod-gateway
description: Runs production-oriented validation before promotion—validate-prod checks, typecheck, secret scan, build—and catches leaked env patterns locally. Use when preparing a merge or release, smoke-testing after substantive edits, verifying Docker/PWA build assumptions, or comparing local behavior to CI expectations.
---

# Dev-to-prod gateway

## Quick start

1. Ensure `.env` / `.env.local` reflect what you intend (never commit secrets).
2. From repo root run:
   - `pnpm validate:prod` → `scripts/validate-prod.ts` (env, secret scan, build script)
   - `npx tsc --noEmit`
3. Treat **FAIL** from validate-prod as merge-blocking for production-bound branches.

## What validate:prod covers

See `scripts/validate-prod.ts`: required env vars for prod posture, `scripts/scan-secrets.ts`, frontend build via `scripts/validate-build.sh` (needs Git Bash or WSL on Windows), HTTP probes where configured.

## Workflows

### Pre-merge smoke

- Run the gateway script on your branch after rebasing onto main.
- If Windows lacks bash for the build step, run `pnpm build` as an explicit substitute and note it in the PR.

### Leaked configuration

- No live keys in `src/` or `server/`; use env templates from `.env.example`.
- Compare against `.gitignore` for accidental artifact commits.

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm typecheck && pnpm validate:prod` | Typecheck then env / secret-scan / build checks |

## References

- `package.json` scripts (`validate:prod`, `build`, `start`)
- CI: repository workflow YAML under `.github/workflows/` if present
- Related smoke: `pnpm typecheck && pnpm test` (see the `clinical-enterprise-integrity` skill)
