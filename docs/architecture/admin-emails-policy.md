# ADMIN_EMAILS policy

## Behavior

| Event | Promotion? |
|-------|------------|
| New Clerk user, email in `ADMIN_EMAILS`, first upsert | Yes — `role: admin`, `status: active` at insert |
| Existing user, email added to `ADMIN_EMAILS`, next login | **No** — use `scripts/ops/promote-user-by-email.ts` or admin pending-user approve |
| Demoted admin, email still in `ADMIN_EMAILS`, next login | **No** — per-request re-promotion removed |
| Dev bypass (`DEV_USER`) | Unaffected by `ADMIN_EMAILS` |

## Ops: demote an env-admin

1. Remove email from `ADMIN_EMAILS`, redeploy.
2. Demote in admin UI or DB.

## Ops: promote existing user after adding to allowlist

Run `scripts/ops/promote-user-by-email.ts` or approve via **Admin → Pending users**.

## Source

- Parser: `server/lib/admin-email-allowlist.ts`
- Insert-time promotion: `server/middleware/auth.ts` (Clerk upsert path only)
- Role authority: always from `vt_users.role` in DB, never JWT claims
