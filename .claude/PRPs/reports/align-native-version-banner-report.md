# Implementation Report: Align Home Update Banner with Native App Version

## Summary
Native Capacitor shell now shows the iOS `MARKETING_VERSION` (via `App.getInfo()`) in the home UpdateBanner and Settings About section, instead of the web/backend semver from `/api/version`. Web/PWA behavior is unchanged (server-driven). Locale `whatsNew.buildLabel` synced to Build 16.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Small | Small |
| Confidence | 9/10 | 9/10 |
| Files Changed | 5–7 | 7 |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Extract shared version utilities | ✅ Complete | `src/lib/app-version.ts` |
| 2 | Update home UpdateBanner | ✅ Complete | Native vs web branch |
| 3 | Fix Settings About version | ✅ Complete | `resolveDisplayAppVersion()` on mount |
| 4 | Sync locale build label | ✅ Complete | Build 16 en/he |
| 5 | Unit tests | ✅ Complete | 6 tests in `tests/app-version.test.ts` |
| 6 | Release docs touch-up | ✅ Complete | `docs/mobile/release.md` |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | ✅ Pass | `npx tsc --noEmit` zero errors |
| Unit Tests | ✅ Pass | 6 app-version + 4 i18n-parity |
| Build | ✅ Pass | `pnpm build` succeeded |
| Integration | N/A | Native sim spot-check recommended post-archive |
| Edge Cases | ✅ Pass | Covered in unit tests (native/web/failure paths) |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `src/lib/app-version.ts` | CREATED | +40 |
| `tests/app-version.test.ts` | CREATED | +64 |
| `src/components/update-banner.tsx` | UPDATED | refactor to use app-version lib |
| `src/pages/settings.tsx` | UPDATED | dynamic display version |
| `locales/en.json` | UPDATED | buildLabel → Build 16 |
| `locales/he.json` | UPDATED | buildLabel → בילד 16 |
| `docs/mobile/release.md` | UPDATED | locale sync checklist step |

## Deviations from Plan
None — implemented exactly as planned.

## Issues Encountered
None — implementation was already in progress on branch `feat/legal-pages-privacy-terms-support`; validated and completed.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `tests/app-version.test.ts` | 6 | compareVersions, native/web resolvers, server fetch success/failure |

## Next Steps
- [ ] Rebuild native shell: `./scripts/build-native-shell.sh` + sim spot-check
- [ ] Code review via `/code-review`
- [ ] Commit on feature branch when ready
