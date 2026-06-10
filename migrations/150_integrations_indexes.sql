-- Indexes for integration tables — hit on every integration dashboard load
-- and sync-conflict list.

-- vt_integration_configs: unique clinic+adapter pair; enabled-sync sweep
CREATE UNIQUE INDEX IF NOT EXISTS idx_vt_integration_configs_clinic_adapter_uq
  ON vt_integration_configs (clinic_id, adapter_id);

CREATE INDEX IF NOT EXISTS idx_vt_integration_configs_enabled
  ON vt_integration_configs (enabled, sync_patients);

-- vt_integration_sync_conflicts: open-conflict list per clinic
CREATE INDEX IF NOT EXISTS idx_vt_integration_sync_conflicts_clinic_status
  ON vt_integration_sync_conflicts (clinic_id, status);

-- vt_integration_sync_log: log list per clinic+adapter and failure alerts
CREATE INDEX IF NOT EXISTS idx_vt_integration_sync_log_clinic_adapter_status
  ON vt_integration_sync_log (clinic_id, adapter_id, status);

CREATE INDEX IF NOT EXISTS idx_vt_integration_sync_log_clinic_status
  ON vt_integration_sync_log (clinic_id, status);

-- vt_integration_mapping_reviews: pending-review list per clinic+adapter
CREATE INDEX IF NOT EXISTS idx_vt_integration_mapping_reviews_clinic_adapter_status
  ON vt_integration_mapping_reviews (clinic_id, adapter_id, review_status);

-- vt_integration_webhook_events: pending/failed events per clinic+adapter
CREATE INDEX IF NOT EXISTS idx_vt_integration_webhook_events_clinic_adapter_status
  ON vt_integration_webhook_events (clinic_id, adapter_id, status);
