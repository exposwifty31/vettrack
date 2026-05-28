# 10 — patchEquipmentSchema.strict() (P3.5 / F7)

## Context

**F7:** Unknown PATCH fields were silently stripped by Zod.

## Change

`server/routes/equipment.ts` — `.strict()` on `patchEquipmentSchema`.

## Verification

`pnpm test -- patch-equipment-strict-f7`

## Rollback

`git revert`
