# 05 — Suppress fake $1.00 billing default (P2.4 / F9)

## Context

**F9:** `resolveBillingItemForEquipment` falls back to `getOrCreateDefaultEquipmentBillingItem` (100¢) when equipment has no `billingItemId`. Pilot audits would show spurious $1.00 ledger rows.

## Change

| File | Summary |
|------|---------|
| `server/lib/equipment-seen.ts` | `isPilotDefaultBillingSuppressed()` when `PILOT_SUPPRESS_DEFAULT_BILLING=true`. `resolveBillingItemForEquipment` returns `null` instead of creating DEFAULT_EQUIPMENT. `processEquipmentSeenInTx` updates `lastSeen` only (no ledger) and returns `billingSkipped: true`. Configured `billingItemId` still bills normally. |
| `tests/pilot-suppress-default-billing-f9.test.ts` | Env flag branches. |

## Why this approach

- Preserves real configured rates; only blocks the synthetic default item.  
- **Rejected:** Always-zero default item — still creates ledger noise.

## Verification

```bash
pnpm test -- pilot-suppress-default-billing-f9
npx tsc --noEmit
pnpm test
```

## Rollback

Unset `PILOT_SUPPRESS_DEFAULT_BILLING` on Railway.

## Refs

- Plan: P2.4 (F9)
