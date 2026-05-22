# Runbook — Activate admin by email

Use when a user sees **“החשבון ממתין לאישור הנהלת ביה״ח”** / account pending approval on production.

## Option A — `ADMIN_EMAILS` (recommended for owners)

1. Railway → **VetTrack production** service → **Variables**
2. Set or append **`ADMIN_EMAILS`** (comma-separated, no spaces required after commas):
   ```
   danerez5@gmail.com
   ```
   If other admins already exist, append: `existing@clinic.com,danerez5@gmail.com`
3. **Redeploy** the service (variable change triggers deploy).
4. User **signs out** and signs in again — auth promotes them to `admin` + `active` on login.

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

## Verify

```bash
curl -sS https://vettrack.uk/api/healthz
```

User should reach the dashboard after sign-in (not the pending screen).
