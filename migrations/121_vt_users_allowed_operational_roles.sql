-- Phase 2.5 PR 1: Add allowed operational roles list to vt_users.
-- Additive only. No backfill required; default is an empty JSON array.
-- No runtime resolver / middleware / route behavior changes in this PR.

ALTER TABLE vt_users
  ADD COLUMN IF NOT EXISTS allowed_operational_roles JSONB NOT NULL DEFAULT '[]'::jsonb;
