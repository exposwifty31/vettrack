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
-- A nullable column add takes only a metadata-level ACCESS EXCLUSIVE lock (no
-- table rewrite, no default backfill), so it is safe on the production users
-- table. Existing rows read NULL (no vet license on file), which the approval
-- gate treats as "vet cannot be auto-applied" — the intended default.

ALTER TABLE vt_users ADD COLUMN IF NOT EXISTS vet_license_number varchar(40);
