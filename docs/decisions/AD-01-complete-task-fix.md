# AD-01: completeTask Transaction Fix

**Status:** DRAFT — not approved for implementation

## The Bug

`db.insert(inventoryJobs)` runs outside the billing transaction in `completeTask`. If the insert fails after billing commits, billing is recorded but inventory is never deducted and never recoverable — the row that the recovery sweep looks for doesn't exist.

## Decision

**Option A** — move `db.insert(inventoryJobs)` inside the `db.transaction()` callback using `tx.insert()` (not `db.insert()`). The queue enqueue stays outside. If queue fails after commit, the recovery sweep finds the orphaned job row within 10 minutes.

## Kill Switch

`DISABLE_INVENTORY_ENQUEUE=false` in Railway env vars. Set to `true` to pause inventory enqueue without stopping billing.

## Rollback

Code-only change, no migration. `git revert [SHA]` → Railway redeploys in ~2 minutes.

## Pre-Deployment

Run orphan audit query against production first. Record baseline count. Do not deploy on top of an existing backlog.

## Tests Required

1. Happy path
2. Transaction rollback
3. Queue failure
4. Idempotency
5. Concurrent completions

## Must Not Implement Until

- Slept on it
- Adversarial review done
- Q1–Q3 answered
- Kill switch set in Railway
