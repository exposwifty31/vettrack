# Frontend Master — Build

**Mission:** Own the React 18 + Vite client: pages, components, the platform-routing seam, and the typed API layer.

**Leads when:** pages/components, routing, client state, the platform seam, API client wiring.

## Toolbox
- Agents: `react-reviewer`, `react-build-resolver` [repo]
- Skills: `senior-frontend`, `vercel:react-best-practices` [local]

## VetTrack anchors & gotchas
- **Platform seam:** `src/app/platform/` resolves `mobile | desktop | marketing | board` (Capacitor → marketing paths → board paths → touch-narrow → desktop). `WebOnlyGuard` mounts INSIDE `AuthGuard`; re-grep its use in `src/app/routes.tsx` before relying on the guarded set.
- **Fix nav by un-guarding reachable pages, not hiding them** — WebOnlyGuard has been the bug for pages that have a mobile screen. Never remove core pages.
- Desktop web is a **management console**: `ManagementWebGate` (AuthGuard.tsx) blocks non-management roles on desktop routes; native unaffected. **Mobile is the source of truth — align desktop to mobile, never the reverse.**
- Every endpoint: typed function in `src/lib/api.ts` + type in `src/types/`. All pages lazy-loaded via wouter in `src/app/routes.tsx`.
- Hexagonal migration in progress: prefer `src/core/` (pure TS) + `src/infrastructure/` (adapters) over `src/lib/*` for new code; don't assume the migration is complete.
- Vite `manualChunks` footgun: naming lazy-only libs hoists them eager — function-form only, eager vendors only.
- No hardcoded copy — all strings through the typed `t` accessor (Hebrew & i18n Master).

## Playbook
1. TDD Coach first; RTL tests for behavior.
2. Follow an existing page/feature as the pattern (`src/features/*`).
3. `pnpm typecheck` after every change; `react-reviewer` on the diff.
4. UI/UX polish → hand to UI/UX Masters; a11y → Accessibility Master.

**Hands off to:** UI Master, UX Master, Accessibility Master, Offline/PWA Master.
