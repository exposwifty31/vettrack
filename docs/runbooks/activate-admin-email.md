# Runbook — Activate admin by email

Use when a user sees **"החשבון ממתין לאישור הנהלת ביה״ח"** / account pending approval on production.

> **Known bug (backlog P1-8):** The `ADMIN_EMAILS` promotion runs on **every authenticated request** for matching users, not only on first sign-in. This means a user whose email is in `ADMIN_EMAILS` will be re-promoted to `admin` on every request even if they were manually demoted via the UI or DB. If you demote an `ADMIN_EMAILS` user without also removing their email from the variable, the demotion will be reversed on their next request. To permanently demote such a user: (1) remove their email from `ADMIN_EMAILS`, (2) redeploy, then (3) demote via Option B or the admin UI. See §Demotion below. This per-request re-promotion is a known defect tracked as backlog item P1-8.

## Option A — `ADMIN_EMAILS` (recommended for owners)

1. Railway → **VetTrack production** service → **Variables**
2. Set or append **`ADMIN_EMAILS`** (comma-separated, no spaces required after commas):
   ```
   danerez5@gmail.com
   ```
   If other admins already exist, append: `existing@clinic.com,danerez5@gmail.com`
3. **Redeploy** the service (variable change triggers deploy).
4. **New users only:** after redeploy, the user's **first sign-in** creates their `vt_users` row with `role: admin` and `status: active` (insert-time promotion).
5. **Existing users:** adding an email to `ADMIN_EMAILS` does **not** promote on login — use Option B or Option C below.

## Option B — Direct DB promote (immediate, no redeploy)

From a machine with Railway CLI linked to the project:

```bash
railway run --service vettrack pnpm exec tsx scripts/ops/promote-user-by-email.ts \
  --email=danerez5@gmail.com --allow-production
```

The user must have signed in at least once so a `vt_users` row exists.

Then sign out / sign in on [vettrack.uk](https://vettrack.uk).

## Option C — Another clinic admin

An active **admin** can approve in the app: **Admin** → **Pending users** → Approve.

## Demotion

To demote an env-admin:

1. Remove their email from **`ADMIN_EMAILS`** and redeploy.
2. Demote in the admin UI or via DB/script.

Order matters — removing from `ADMIN_EMAILS` first prevents insert-time promotion for new accounts; demotion in the DB/UI removes existing admin access.

## Dev bypass

`ADMIN_EMAILS` does **not** affect dev-bypass auth (`DEV_USER` in `server/middleware/auth.ts` when `CLERK_SECRET_KEY` is unset).

## Verify

```bash
curl -sS https://vettrack.uk/api/healthz
```

User should reach the dashboard after sign-in (not the pending screen).

See also: `docs/architecture/admin-emails-policy.md`
