# 09 — Emergency staging TTL sweep (P3.4 / F6)

## Context

**F6:** Emergency staging claims with `expiresAt = null` never expired; equipment could stay staged indefinitely.

## Change

- `stagingExpiryWorker.ts` — second sweep for `active` + `expiresAt IS NULL` + `stagedAt` older than `EMERGENCY_STAGING_TTL_HOURS` (default 8).
- `audit.ts` — `equipment_emergency_staging_expired` audit kind.

## Verification

`pnpm test -- staging-emergency-ttl-f6`

## Rollback

`git revert`; SQL restore note in parent plan if rows expired early.
