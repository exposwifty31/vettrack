-- Phase 3: Billing linkage — adds scan_log_id and usage_session_id to vt_billing_ledger
-- These are nullable foreign references; existing rows are unaffected (remain NULL).
-- scan_log_id: populated when a scan event directly triggers a billing charge.
-- usage_session_id: populated by the equipment-seen flow (processEquipmentSeenInTx).

ALTER TABLE vt_billing_ledger
  ADD COLUMN IF NOT EXISTS scan_log_id TEXT,
  ADD COLUMN IF NOT EXISTS usage_session_id TEXT;
