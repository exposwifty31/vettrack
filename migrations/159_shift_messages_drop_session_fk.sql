-- Shift-chat is re-anchored to roster shift windows (vt_shifts): messages now
-- carry synthetic window ids ("win:<clinic>:<date>:<start>") alongside legacy
-- vt_shift_sessions ids. Drop the FK — the legacy clock-in table is orphaned
-- (nothing writes it), and its ON DELETE CASCADE would erase chat history if
-- the dead rows were ever cleaned up. Both name variants covered: 073 created
-- it inline (postgres auto-name), dev databases may carry the drizzle-push name.
ALTER TABLE vt_shift_messages DROP CONSTRAINT IF EXISTS vt_shift_messages_shift_session_id_fkey;
ALTER TABLE vt_shift_messages DROP CONSTRAINT IF EXISTS vt_shift_messages_shift_session_id_vt_shift_sessions_id_fk;
