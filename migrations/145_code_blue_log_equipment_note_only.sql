-- Code Blue log entries: equipment-focused categories only (no shock/CPR clinical quick-log).

ALTER TABLE vt_code_blue_log_entries DROP CONSTRAINT IF EXISTS vt_code_blue_log_entries_category_check;

ALTER TABLE vt_code_blue_log_entries
  ADD CONSTRAINT vt_code_blue_log_entries_category_check
  CHECK (category IN ('equipment', 'note'));
