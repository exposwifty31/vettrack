# 06 — bulk-delete dependent cleanup (P3.1 / F3)

## Context

**F3:** `POST /api/equipment/bulk-delete` soft-deleted equipment but left active waitlist and staging-queue rows orphaned. A follow-up Codex review (PR #561, `discussion_r3321922654`) found that cancelling staging claims without resetting `usage_state` left restored rows bricked (`409 STAGING_CONFLICT` on checkout).

## Change

| File | Summary |
|------|---------|
| `server/routes/equipment/handlers/post-equipment-bulk-delete.ts` | In the same transaction as soft-delete, bulk-cancel dependent rows and reset staged usage state. |
| `tests/equipment-bulk-delete-f3.integration.test.ts` | Integration tests (requires `DATABASE_URL`). |
| `docs/pilot-mode/06-bulk-delete-cleanup.md` | This doc. |

### Bulk-delete transaction cleanup (four actions)

1. Soft-delete equipment rows (`deletedAt`, `deletedBy`).
2. Cancel active waitlist rows (`vt_equipment_waitlist` → `status='cancelled'` for `waiting` / `notified`).
3. Cancel active staging claims (`vt_staging_queue` → `status='cancelled'` for `active`).
4. Reset `usageState` from `'staged'` → `'available'`, set `usageStateSince`, and bump `version` on equipment that was staged at delete time — so a future `POST /:id/restore` is checkout-usable (Codex P2, `discussion_r3321922654`). Custody / readiness / checkout fields are not touched here.

## Why this approach

- **Locality:** bulk-delete owns orphan cleanup; restore stays a pure undo of soft-delete.
- **Rejected:** fixing only on restore — restore would need to guess whether claims were cancelled by delete vs. other flows.
- **Rejected:** clearing custody/readiness on delete — soft-delete already removes the row from the floor; the gap was only `usageState` vs. cancelled claims.

## Verification

```bash
npx tsc --noEmit
pnpm test
DATABASE_URL=... pnpm test -- equipment-bulk-delete-f3
pnpm build
```

## Rollback

`git revert` on the merge commit. No migration.

## Refs

- Plan: P3.1 (F3)
- PR: #561
- Codex: `discussion_r3321922654` (staged `usageState` reset)
