# 04 — Suppress hardcoded English pushes (P2.3 / F8)

## Context

**F8:** Three equipment routes broadcast English push titles ("Equipment Transferred", "Equipment Returned", "Bulk Transfer") via `sendPushToAll`. Hebrew-default pilot clinics already get localized charge-alert / waitlist pushes elsewhere.

## Change

| File | Summary |
|------|---------|
| `server/lib/push.ts` | `shouldSendPilotEnglishEquipmentPush()` — false when `PILOT_DISABLE_EN_PUSH=true`. |
| `server/routes/equipment/handlers/patch-equipment.ts` | Gate transfer push. |
| `server/routes/equipment.ts` | Gate return push. |
| `server/routes/equipment/handlers/post-equipment-bulk-move.ts` | Gate bulk-move push. |
| `tests/pilot-disable-en-push-f8.test.ts` | Env flag both branches. |

Set `PILOT_DISABLE_EN_PUSH=true` on Railway before pilot launch.

## Why this approach

- Avoids Hebrew literals in `.ts` (i18n-no-hebrew-in-source). Full localization deferred to Phase 5.  
- **Rejected:** Inline `if (isPilotMode)` — server pilot mode is env-gated separately from browser override.

## Verification

```bash
pnpm test -- pilot-disable-en-push-f8
pnpm test
```

## Rollback

Unset `PILOT_DISABLE_EN_PUSH` in Railway (no redeploy required if runtime reads env dynamically — verify after deploy).

## Refs

- Plan: P2.3 (F8)
