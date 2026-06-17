# Legal & compliance pages

Public legal pages required for App Store / Play Store submission and for sign-up transparency. **Status: implemented** (verified 2026-06-17).

Related: [account-deletion.md](./account-deletion.md) (Guideline 5.1.1(v) — implemented).

---

## Current state

| URL | Route | Page component | Auth |
|-----|-------|----------------|------|
| `https://vettrack.uk/privacy` | `/privacy` | `privacy-policy.tsx` | Public |
| `https://vettrack.uk/terms` | `/terms` | `terms-of-use.tsx` | Public |
| `https://vettrack.uk/support` | `/support` | `support.tsx` | Public |

Notes:

- All three routes are **public** (no `AuthGuard`) — suitable for App Store / Play Console URLs after production deploy.
- Sign-in, sign-up, settings, and marketing footer link to all three pages.
- `/help` remains auth-guarded — in-app feature guide, not a substitute for public support.

---

## Why this blocks store submission

| Requirement | Source | Gap |
|-------------|--------|-----|
| Privacy Policy URL | App Store Connect → App Information | URL must resolve to readable policy text |
| Privacy Policy URL | Google Play → Store listing | Same |
| App Privacy questionnaire alignment | Apple Guideline **5.1.1** | Questionnaire must match actual collection; policy must describe it |
| Sign-up transparency | Apple / GDPR best practice | Users should reach policy before or during account creation |
| Account deletion disclosure | Guideline **5.1.1(v)** | Policy should describe what is deleted (see [account-deletion.md](./account-deletion.md)) |

---

## Implementation checklist

When adding legal pages, follow existing VetTrack patterns:

### 1. Public routes (no `AuthGuard`)

Add to `src/app/routes.tsx`:

| Path | Component | Auth |
|------|-----------|------|
| `/privacy` | `PrivacyPolicyPage` | Public |
| `/terms` | `TermsOfUsePage` | Public |
| `/support` | `SupportPage` (or redirect to mailto + FAQ) | Public |

Regenerate route inventory: `pnpm docs:audit`.

### 2. Page components

- New files under `src/pages/` (e.g. `privacy-policy.tsx`, `terms-of-use.tsx`, `support.tsx`).
- Use `Helmet` for `<title>` and meta description (same pattern as sign-in).
- Render long-form copy from locale keys — **no hardcoded Hebrew in `.tsx`** (`tests/i18n-no-hebrew-in-source.test.ts`).
- Add paired keys in `locales/en.json` and `locales/he.json`; run `pnpm i18n:check` + `pnpm i18n:generate-types`.
- Accessible layout: semantic headings, readable line length, `min-h-[100dvh]`, back link to `/` or `/signin`.

### 3. In-app links

| Surface | Link |
|---------|------|
| `/signin`, `/signup` | Footer row: Privacy · Terms |
| `/settings` | Legal section: Privacy · Terms · Support |
| Clerk `SignUp` | Optional: `unsafeMetadata` / Clerk dashboard legal links if using hosted components |

### 4. Privacy policy content (must cover actual collection)

Draft against what the app **actually** does today. Cross-check App Store **App Privacy** and Google **Data safety** questionnaires.

| Data category | Where collected | Disclose in policy |
|---------------|-----------------|-------------------|
| Account (email, name, phone) | Clerk auth | Yes |
| Sign in with Apple | Native + Clerk | Yes; link to Apple token handling in [account-deletion.md](./account-deletion.md) |
| Clinic / role / shift context | `vt_users`, shifts | Yes (operational, not marketing) |
| Equipment scans, photos, NFC | Camera, filesystem, NFC plugins | Yes — device permissions |
| Push notifications | Web push / native | Yes — optional opt-in |
| Audit logs | Server-side | Yes — retention, clinic-scoped |
| Error / performance telemetry | Sentry (if enabled) | Yes |
| Realtime usage metrics | Bounded enums via `/api/realtime/telemetry` | Yes — no PII per Phase 9 contract |
| Offline cache | IndexedDB (Dexie) | Yes — device-local, clinic-scoped |

Policy should also state: data controller contact, retention, deletion path (Settings → Delete account), children (not directed at under-13), and jurisdiction (IL/UK operations).

### 5. Store metadata

After pages are live on production:

1. Verify in a browser (not just `curl -I`): `https://vettrack.uk/privacy` shows policy text without login.
2. Update App Store Connect **Privacy Policy URL** and Google Play **Privacy policy** to match.
3. Update [store-metadata.md](./mobile/store-metadata.md) status from **placeholder** to **live**.
4. Add a row to [native-ship-checklist.md](./mobile/native-ship-checklist.md) prerequisites (see below).

### 6. Verification

```bash
# After deploy — body must contain policy heading, not 404 copy
curl -s "https://vettrack.uk/privacy" | grep -i "privacy\|פרטיות" | head -3

pnpm i18n:check
npx tsc --noEmit
pnpm docs:audit
```

Optional: Playwright smoke that `/privacy` and `/terms` render without auth.

---

## Suggested contact addresses (fill before publish)

| Purpose | Suggested value |
|---------|-----------------|
| Privacy / DPO | `privacy@vettrack.uk` |
| Support | `support@vettrack.uk` |
| Account deletion | Covered in-app; policy references same inbox |

Confirm domains and mailboxes exist before linking them in store listings.
