# VetTrack native mobile

Capacitor v8 shell for iOS and Android. Production ships a **bundled** web asset (Option B) with Clerk auth — not a remote URL wrapper.

## Ship path (current)

| Doc | Purpose |
|-----|---------|
| [native-ship-checklist.md](./native-ship-checklist.md) | Pre-submission checklist |
| [native-ship-audit-workflow.md](./native-ship-audit-workflow.md) | **Human** (Safari/Chrome audit) vs **Agent** (fix → Railway → archive) split + prompts |
| [native-ship-master-prompt.md](./native-ship-master-prompt.md) | **Full copy-paste prompt** for Cursor (Phases 0–7) |
| [nfc-ship-checklist.md](./nfc-ship-checklist.md) | NFC readiness |
| [release.md](./release.md) | Release automation notes |
| [../capacitor-native-app.md](../capacitor-native-app.md) | Build, sync, simulator install |
| [../RESUBMISSION_RUNBOOK.md](../../RESUBMISSION_RUNBOOK.md) | App Store resubmission gates |

## Commands

```bash
pnpm cap:build:native          # iOS bundled shell
pnpm cap:build:native:android
pnpm cap:install:ios-sim       # build + install simulator
./scripts/verify-resubmission.sh
```

## Horizon (not current ship blocker)

| Doc | Purpose |
|-----|---------|
| [native-mobile-implementation-manual.md](./native-mobile-implementation-manual.md) | Capacitor → Expo/RN evaluation manual |
| [store-metadata.md](./store-metadata.md) | App Store / Play listing copy |

## Audit artifacts

- [vettrack-native-ship-audit.json](./vettrack-native-ship-audit.json) — machine-readable ship audit
- [native-ship-checklist.md](./native-ship-checklist.md) — human checklist
