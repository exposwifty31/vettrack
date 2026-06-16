# Fork provenance — expo (VKirill)

| Field | Value |
|-------|-------|
| **Upstream** | [VKirill/antigravity-for-claude-code/skills/expo](https://github.com/VKirill/antigravity-for-claude-code/tree/HEAD/skills/expo) |
| **Forked into** | `.agents/skills/expo/` |
| **Security review** | 2026-06-15 |
| **Adopt when** | Horizon 1 — EAS + dev client + NFC plugin |

## Security review (2026-06-15)

**Contents:** `SKILL.md` + `references/*.md` only (no executable scripts).

| Check | Result |
|-------|--------|
| Hardcoded secrets | None; docs warn against `EXPO_PUBLIC_*` for secrets |
| Shell in docs | `troubleshooting.md` suggests `rm -rf node_modules ios android` — standard clean rebuild; operator-initiated only |
| Network examples | Documented `curl` to `exp.host` push API — official Expo endpoint |
| Credential guidance | Recommends EAS Secrets / ASC API keys over app-specific passwords |

**Residual risk:** Version pins in `SKILL.md` (SDK 55 / RN 0.85) may drift from VetTrack `packages/mobile` — always verify `package.json` before scaffolding.

## VetTrack context

| Topic | VetTrack doc |
|-------|----------------|
| Monorepo + native shell | [docs/mobile/README.md](../../../docs/mobile/README.md) |
| Implementation manual | [docs/mobile/native-mobile-implementation-manual.md](../../../docs/mobile/native-mobile-implementation-manual.md) |
| Clerk on RN | Horizon 2 — `@clerk/clerk-expo`, `vettrack://` |
| NFC plugin | `react-native-nfc-manager` config plugin (Horizon 1.4) |
| Push (native) | Horizon 4 — `POST /api/push-subscriptions/native` |

Do not use this skill for Capacitor-only work during Horizon 0 — Capacitor freeze is active.
