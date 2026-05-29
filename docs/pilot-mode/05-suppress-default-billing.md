# 05 — Suppress fake $1.00 billing default (P2.4 / F9)

## Context

**F9:** `resolveBillingItemForEquipment` falls back to `getOrCreateDefaultEquipmentBillingItem` (100¢) when equipment has no `billingItemId`. Pilot audits would show spurious $1.00 ledger rows.

## Change

| File | Summary |
|------|---------|
| `server/lib/equipment-seen.ts` | `isPilotDefaultBillingSuppressed()` / `shouldInsertDefaultEquipmentLedger()` when `PILOT_SUPPRESS_DEFAULT_BILLING=true`. Skips **only** the synthetic `DEFAULT_EQUIPMENT` 100¢ ledger row when equipment has no configured `billingItemId`. `packageCode` → `fluid_protocol` consumable rows (4 per scan) still insert. With suppress on and no `packageCode`, `processEquipmentSeenInTx` returns `billingSkipped: true` after `lastSeen` only. Configured `billingItemId` still bills normally. |
| `tests/pilot-suppress-default-billing-f9.test.ts` | Env flag + regression matrix (suppress only / suppress + package / baseline). |

## Why this approach

- Preserves real configured rates and package consumable billing; only blocks the synthetic default item.  
- **Rejected:** Early return from `resolveBillingItemForEquipment` when suppressed — that also dropped `packageCode` ledger rows (Codex P1 on PR #563, `discussion_r3321920325`).  
- **Rejected:** Always-zero default item — still creates ledger noise.

The gate suppresses **only** the synthetic `DEFAULT_EQUIPMENT` 100¢ ledger row. Any other ledger inserts (`packageCode` → `fluid_protocol` consumables, future package codes) continue to run normally. This was clarified after Codex review on PR #563 (`discussion_r3321920325`).

## Verification

```bash
pnpm test -- pilot-suppress-default-billing-f9
npx tsc --noEmit
pnpm test
```

## Rollback

Unset `PILOT_SUPPRESS_DEFAULT_BILLING` on Railway.

Do **not** revert from `main` unless product explicitly removes this pilot feature. If reverting, revert commits [`10f0e463`](https://github.com/dboy3156/VetTrack/commit/10f0e463) and [`4f36d6ca`](https://github.com/dboy3156/VetTrack/commit/4f36d6ca) together.

## Main merge audit trail

| Item | Detail |
|------|--------|
| Intended PR | [#563](https://github.com/dboy3156/VetTrack/pull/563) |
| Also merged via | [#577](https://github.com/dboy3156/VetTrack/pull/577) (Slice 6g forecast types branch carried the same F9 commits unintentionally) |
| Commits on `main` | `10f0e463` then `4f36d6ca` — **both required**; `10f0e463` alone over-suppresses `packageCode` consumables |
| Opt-in | `PILOT_SUPPRESS_DEFAULT_BILLING=true` only |
| Default | Env unset → no behavior change vs pre-F9 |

See also [README.md](./README.md) § P2.4 / F9 — suppress default billing (audit trail).

## Refs

- Plan: P2.4 (F9)
