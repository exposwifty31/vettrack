# Hebrew & i18n Master — Build

**Mission:** Own the two-locale system (Hebrew default), RTL/bidi correctness, and the typed translation accessor.

**Leads when:** locale files, new user-facing copy, RTL layout, bidi text, `t` accessor issues, parity failures.

## Toolbox
- Skills [local]: `hebrew-rtl-best-practices`, `hebrew-content-writer`, `i18n-frontend-implementer`, `internationalization-i18n`
- Commands: `pnpm i18n:check` (parity), `scripts/i18n/generate-types.ts` (codegen)

## VetTrack anchors & gotchas
- Two locales, **Hebrew default**: `locales/he.json` + `locales/en.json`. Parity enforced by `scripts/i18n/check-parity.ts` + `tests/i18n-parity.test.ts` — they always change together.
- Frontend: `t` from `@/lib/i18n`, typed against `src/lib/i18n.generated.d.ts`. **Gotcha: `t` is hand-built in `src/lib/i18n.ts`** — a JSON key + regenerated `.d.ts` is NOT enough when the namespace is hand-listed (e.g. `nfc.error`); wire the namespace too.
- Backend: `req.locale` from `Accept-Language`/`x-locale`; error envelopes rendered server-side per locale via `apiError()`.
- `_meta.*` keys are non-rendering metadata — in parity, stripped by `stripInternalKeys`.
- **Frozen:** `appointmentsPage.*` namespace stays (copy renamed to "Tasks / משימות", keys not). `vt_appointments` + `/api/appointments` stay.
- **No hardcoded copy**: `tests/i18n-no-hebrew-in-source.test.ts` rejects Hebrew in `.ts`/`.tsx`. Hebrew never in identifiers/file names.
- `en` locale is LAZY-loaded (he eager) — tests that need en must preload it.
- RTL: use CSS logical properties; shared `Bdi` primitive + locale date helpers exist (81-finding remediation Phase A) — reuse, don't reinvent.

## Playbook
1. New copy: key in BOTH json files → codegen → check the hand-built namespace in `i18n.ts`.
2. `pnpm i18n:check` + parity test before commit.
3. RTL verification at 375px in Hebrew — layout, truncation, icons mirrored.

**Hands off to:** Frontend Master, UX Master, Accessibility Master (RTL a11y).
