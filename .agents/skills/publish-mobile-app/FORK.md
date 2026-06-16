# Fork provenance — publish-mobile-app

| Field | Value |
|-------|-------|
| **Upstream** | [logesh-kumar/publish-mobile-app](https://github.com/logesh-kumar/publish-mobile-app) |
| **Forked into** | `.agents/skills/publish-mobile-app/` |
| **Security review** | 2026-06-15 |
| **Adopt when** | Horizon 0 Task 0.3 App Review / `fix-rejection` |

## Security review (2026-06-15)

**Scripts reviewed:** `bootstrap-app-store-key.ts`, `check-ios-state.ts`, `create-app-review-user.ts`, `print-reviewer-creds.ts`, `validate-metadata.ts`

| Check | Result |
|-------|--------|
| Hardcoded secrets / API keys | None found |
| Unexpected network targets | Apple App Store Connect API; Supabase admin API only when env vars present |
| Destructive shell (`rm -rf`, `curl \| bash`) | None in scripts |
| Credential file writes | `ios/app-store-connect-key.json` (mode 600), `ios/.env.review` (mode 600) — expected |
| `.env` reads | `create-app-review-user.ts` reads `.env` for Supabase keys only when present; does not exfiltrate |

**Residual risk:** Scripts assume operator runs them locally with intentional env vars. Never commit `ios/app-store-connect-key.json`, `*.p8`, or `ios/.env.review`.

## VetTrack overrides

VetTrack uses **Clerk** (not Supabase) for reviewer demo login. Do **not** run `create-app-review-user.ts` for production reviewer provisioning.

| Concern | VetTrack source of truth |
|---------|--------------------------|
| Demo reviewer account | [RESUBMISSION_RUNBOOK.md](../../../RESUBMISSION_RUNBOOK.md) §C — `reviewer@vettrack.uk` |
| Clerk Client Trust / OAuth | Same runbook §C, §F, §I |
| Pre-submit verification | `./scripts/verify-resubmission.sh` |
| Bundled native build | `./scripts/build-native-shell.sh` |
| NFC evidence | [docs/mobile/nfc-ship-checklist.md](../../../docs/mobile/nfc-ship-checklist.md) |
| Checklist gate | [docs/mobile/native-ship-checklist.md](../../../docs/mobile/native-ship-checklist.md) |

`print-reviewer-creds.ts` and `ios/.env.review` remain useful for Play Console “App access” copy-paste if you maintain creds there manually.

`check-ios-state.ts` and `validate-metadata.ts` are safe to run after metadata pushes.
