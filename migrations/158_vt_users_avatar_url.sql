-- Adds a nullable avatar_url column to vt_users for the profile-picture
-- feature (BUG-013). The URL points at the S3-compatible object store key
-- written by POST /api/uploads/avatar. Nullable: users without an uploaded
-- photo fall back to initials in the UI.
ALTER TABLE vt_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
