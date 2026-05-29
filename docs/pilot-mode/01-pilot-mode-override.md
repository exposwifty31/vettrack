# 01 — Per-browser pilot mode override (Phase 1)

## Context

**F-number:** Phase 1 (foundation, not an F-fix).  
**Problem:** Railway ships `VITE_PILOT_MODE=false` by default; operators need to collapse the nav to equipment-only scope on a single browser without redeploying.  
**Who:** Pilot department admins and technicians at vettrack.uk.  
**Shipped code:** merged on `main` as `52e1cb8` (PR #558); doc index in `9f79536` (PR #557).

## Change

| Area | File | Summary |
|------|------|---------|
| Frontend pilot resolution | `src/lib/pilot-mode.ts` | `localStorage` key `vt_pilot_mode_override` (`true` / `false` / removed) overrides `VITE_PILOT_MODE` at module load. Exports `getPilotModeOverride`, `setPilotModeOverride`, `pilotModeEnvDefault`. |
| Nav allowlist | `src/components/layout.tsx` | Pilot menu keeps equipment surfaces + Ward Display (`/display`); removes `/code-blue`, `/crash-cart`, `/admin/code-blue-history`. Code Blue / Crash Cart / Ward Display routes stay registered (always mounted) for emergency deep-link access. |
| Route gating (intentional) | `src/app/routes.tsx:137-166` | Full-platform routes (`/billing`, `/patients`, `/meds`, `/analytics`, `/inventory`, `/appointments`, `/admin/shifts`, etc.) are mounted under `{!isPilotMode && ...}`. When the override turns pilot mode on, those routes also unmount and direct URLs go to Not Found. This is the intended pilot simulation, not a bug. Codex flagged this on PR #558; the plan owner confirmed the semantics. |
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
- Doc PR: #557 (index), #558 (code @ `52e1cb8`); P1.2 copy clarification in consolidated docs catch-up PR

## Known design choice — override affects route mounting

Codex review of PR #558 (comment `discussion_r3321398648`) noted that the override does more than collapse the menu: full-platform routes gated by `{!isPilotMode && ...}` in `src/app/routes.tsx:137-166` also unmount. After review, the team chose to keep this behavior — "Force on" is a faithful pilot-mode simulation, including route restrictions. Code Blue / Crash Cart / Ward Display routes remain always-mounted independently and continue to be reachable via direct URL.

If a user on a full-platform deploy needs to reach `/billing` etc. while the override is on, the path is: Admin → Pilot Mode card → "Use server default" → reload.
