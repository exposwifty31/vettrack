-- Code Blue log entries: no new drug-category rows (equipment-focused emergency log).

ALTER TABLE vt_code_blue_log_entries DROP CONSTRAINT IF EXISTS vt_code_blue_log_entries_category_check;

ALTER TABLE vt_code_blue_log_entries
  ADD CONSTRAINT vt_code_blue_log_entries_category_check
  CHECK (category IN ('shock', 'cpr', 'note', 'equipment'));
