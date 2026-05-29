# 04 — Suppress hardcoded English pushes (P2.3 / F8)

## Context

**F8:** Five equipment workflows broadcast hardcoded English push titles via `sendPushToAll`. Hebrew-default pilot clinics already get localized charge-alert / waitlist pushes elsewhere.

## Change

| File | Summary |
|------|---------|
| `server/lib/push.ts` | `shouldSendPilotEnglishEquipmentPush()` — false when `PILOT_DISABLE_EN_PUSH=true`. |
| `server/routes/equipment/handlers/patch-equipment.ts` | Gate **transfer** push (`Equipment Transferred`). |
| `server/routes/equipment.ts` | Gate **return** push (`Equipment Returned`). |
| `server/routes/equipment.ts` | Gate **checkout** push (`Equipment Checked Out`). |
| `server/routes/equipment.ts` | Gate **scan-derived** pushes: issue (`Equipment Issue Reported`), maintenance overdue (`Maintenance Overdue`), sterilization due (`Sterilization Due`). |
| `server/routes/equipment/handlers/post-equipment-bulk-move.ts` | Gate **bulk-move** push (`Bulk Transfer`). |
| `tests/pilot-disable-en-push-f8.test.ts` | Env flag + source contract for all gated sites. |

### Gated English push sites (5 workflows, 7 titles)

1. **Transfer** — `patch-equipment.ts`  
2. **Return** — `equipment.ts`  
3. **Bulk move** — `post-equipment-bulk-move.ts`  
4. **Checkout** — `equipment.ts` (`/:id/checkout`)  
5. **Scan-derived alerts** — `equipment.ts` (status scan handler): issue, maintenance overdue, sterilization due

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
