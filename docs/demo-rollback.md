# Demo day rollback playbook — 2026-05-28

Use this if production misbehaves during the hospital director / IT demo.

## Known-good references

| Label | SHA / URL |
|-------|-----------|
| Pre-pilot-decommission deploy (last known-good full UI) | `d126e03` |
| Pilot unblock merge | `bf096c41` (#497) |
| Pre-demo audit mainline (2026-05-27) | `aa688d81` (#502, #503) |
| Staging fallback | https://vettrack-staging.up.railway.app |

## Railway production rollback

1. Open [Railway](https://railway.app) → VetTrack **production** service.
2. **Deployments** tab → find deployment with commit `d126e03` (or last green deploy before the incident).
3. **⋯** menu → **Rollback** (or redeploy that deployment).
4. If pilot env vars were deleted for #497, document their previous values before re-adding only if intentionally returning to equipment-only pilot.

## Environment variables (post-#497)

For **full platform** mainline:

- Remove or unset `PILOT_MODE` and `VITE_PILOT_MODE` on Railway production.
- Do **not** set `ALLOW_EQUIPMENT_PILOT_MODE=true` unless running a dedicated equipment-pilot host.

## Staging pivot

If production is down but staging is healthy:

1. Direct demo browsers to `https://vettrack-staging.up.railway.app`.
2. Explain transparently that production is rolling back while staging reflects the same build.

## DLQ triage (ops dashboard)

1. `/admin/ops-dashboard` → DLQ panel.
2. **List** → inspect row payloads.
3. **Retry** selected rows after fixing root cause; **Drop** only for known-safe poison messages.

## Contacts

> **Founder action required:** Replace every `[PLACEHOLDER]` below before demo GO.

- Engineering on-call (primary): **[PRIMARY_NAME]** — **[PRIMARY_PHONE]** — Slack `@[PRIMARY_SLACK]`
- Engineering on-call (backup): **[BACKUP_NAME]** — **[BACKUP_PHONE]** — Slack `@[BACKUP_SLACK]` _(optional)_
- Railway project: **[RAILWAY_PROJECT_URL]** (e.g. `https://railway.app/project/<id>`)
- Clerk workspace: **[CLERK_DASHBOARD_URL]**
- Railway support: https://railway.app/help
- Clerk support: https://clerk.com/support
