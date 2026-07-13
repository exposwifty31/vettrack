-- Doctor/license number captured at sign-up for self-requested `vet` role
-- (C3 · gated role-onboarding). Verification artifact the admin reviews before
-- approving the vet grant; its presence is required to auto-apply `vet` on
-- approval (server/lib/approval-role.ts).
--
-- Hand-authored (NOT drizzle-kit generated): the Drizzle snapshot is drifted
-- (see 160_vt_display_devices.sql / 162_vt_damage_events.sql), so `generate`
-- emits spurious rename/drop prompts. This migration is purely additive: one
-- nullable column on the existing vt_users table.
--
-- A nullable column add avoids a table rewrite and a default backfill, but the
-- ALTER still takes ACCESS EXCLUSIVE on vt_users — it briefly blocks ordinary
-- reads and writes. Bound the wait with a short lock_timeout so a long-running
-- transaction on vt_users cannot stall clinical access: if the lock is not
-- granted within the window the statement fails fast and the migration is
-- retried on the next run (rather than blocking indefinitely).
--
-- Existing rows read NULL (no vet license on file), which the approval gate
-- treats as "vet cannot be auto-applied" — the intended default.

SET lock_timeout = '3s';
ALTER TABLE vt_users ADD COLUMN IF NOT EXISTS vet_license_number varchar(40);
