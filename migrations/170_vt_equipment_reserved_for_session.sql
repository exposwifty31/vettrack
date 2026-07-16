-- R-CBF-1.2 — Code Blue soft-reserve advisory hint on crash-cart equipment.
--
-- Nullable ADVISORY column: when an active Code Blue session reserves its
-- nearest-ready cart, reserved_for_session_id points at that session. It NEVER
-- blocks a clinician grabbing a different cart and does not participate in
-- custody-toggle semantics (additive; RFID/custody non-goals preserved).
--
-- Deliberately NOT a FK to vt_code_blue_sessions: a hard FK would fight the
-- "advisory, never blocks" model (end is server-confirmed only — a committed
-- session is never deleted) and add an equipment<->code-blue schema cycle. The
-- write path is compare-and-set (only where NULL) and cleanup is scoped by
-- session id — see server/lib/code-blue-soft-reserve.ts.
--
-- Hand-authored: drizzle-kit generate is non-functional in this repo (its CJS
-- loader cannot resolve the schema's ESM `.js` imports), matching the
-- convention of migrations 164-169. Adding a nullable column with no default is
-- metadata-only on Postgres — no table rewrite, brief catalog lock only.
-- Additive + idempotent (IF NOT EXISTS).

ALTER TABLE vt_equipment ADD COLUMN IF NOT EXISTS reserved_for_session_id TEXT;
