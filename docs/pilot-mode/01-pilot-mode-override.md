# 01 — Per-browser pilot mode override (Phase 1)

## Context

**F-number:** Phase 1 (foundation, not an F-fix).  
**Problem:** Railway ships `VITE_PILOT_MODE=false` by default; operators need to collapse the nav to equipment-only scope on a single browser without redeploying.  
**Who:** Pilot department admins and technicians at vettrack.uk.  
**Shipped code:** commit `3e9d520` on branch `claude/app-demo-prep-yXiUj` (not yet on `main` at doc write time).

## Change

| Area | File | Summary |
|------|------|---------|
| Frontend pilot resolution | `src/lib/pilot-mode.ts` | `localStorage` key `vt_pilot_mode_override` (`true` / `false` / removed) overrides `VITE_PILOT_MODE` at module load. Exports `getPilotModeOverride`, `setPilotModeOverride`, `pilotModeEnvDefault`. |
| Nav allowlist | `src/components/layout.tsx` | Pilot menu keeps equipment surfaces + Ward Display (`/display`); removes `/code-blue`, `/crash-cart`, `/admin/code-blue-history`. Routes stay registered for deep links. |
| Admin UI | `src/pages/admin.tsx` | Card with env default, override, effective value; Force on / Force off / Use server default; reload prompt. |
| i18n | `locales/en.json`, `locales/he.json` | 14 keys under `adminPage.pilotMode*`. |
| Types | `src/lib/i18n.generated.d.ts` | Regenerated via `pnpm i18n:generate-types`. |

Backend pilot mode is unchanged: `resolveBackendPilotMode()` still requires `PILOT_MODE=true` and `ALLOW_EQUIPMENT_PILOT_MODE=true`.

## Why this approach

- **Browser-local override** avoids Railway env churn for demos and single-department pilots.  
- **Rejected:** Server-side per-user pilot flag (schema change, out of scope).  
- **Rejected:** Build-time-only pilot (cannot toggle without redeploy).

## Verification

```bash
# On branch with 3e9d520
grep -q "vt_pilot_mode_override" src/lib/pilot-mode.ts && echo OK
grep -q "pilotModeCardTitle" locales/en.json && echo OK
pnpm i18n:check
npx tsc --noEmit
pnpm test
pnpm build
```

Manual: `/admin` → Pilot Mode card → Force on → confirm reload → nav shows equipment scope only; Force off restores full menu (when env allows).

## Rollback

- **Per browser:** Admin → Use server default, or `localStorage.removeItem('vt_pilot_mode_override')` + reload.  
- **Code:** `git revert 3e9d520` on the branch that contains it. No DB migration.

## Refs

- Parent plan: Phase 1 — Pilot Mode Override + Code Blue allowlist tightening  
- Code commit: `3e9d520`  
- Doc PR: (filled after merge)
