-- Adds a nullable requested_role staging column to vt_users (task T24b).
-- Captures the self-requested role a user picked on the sign-up chips
-- (Clerk unsafeMetadata.requestedRole), stored DISTINCT from the authoritative
-- `role` column. Advisory only: it is NEVER auto-applied as `role` and never
-- feeds clinical authority — an admin sees it as a hint and grants the real
-- role through the existing role-change flow. Nullable: sign-ups that did not
-- pick a chip (or picked an invalid value) leave it NULL.
ALTER TABLE vt_users ADD COLUMN IF NOT EXISTS requested_role VARCHAR(20);
