# 11 — unitConditionStates clinicId filter (P3.6 / F10)

## Context

**F10:** SELECT/UPDATE on `unitConditionStates` in dock-return used equipmentId only; defense-in-depth for multi-tenant.

## Change

`equipment-operational-state.ts` — `eq(unitConditionStates.clinicId, clinicId)` on SELECT and UPDATE in condition verification loop.

## Verification

`pnpm test -- unit-condition-states-clinic-f10`

## Rollback

`git revert`
