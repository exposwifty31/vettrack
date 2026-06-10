-- Indexes for equipment-domain tables (folders, equipment_returns, scan_logs, alert_acks)
-- Previously unindexed on clinic_id; vt_scan_logs in particular is queried on every
-- activity feed, evidence graph, analytics, and home-dashboard load.

-- vt_folders: list by clinic
CREATE INDEX IF NOT EXISTS idx_vt_folders_clinic
  ON vt_folders (clinic_id);

-- vt_equipment_returns: per-equipment return history (charge-alert worker, return detail)
CREATE INDEX IF NOT EXISTS idx_vt_equipment_returns_clinic_equipment
  ON vt_equipment_returns (clinic_id, equipment_id);

-- vt_scan_logs: activity feed (clinic+timestamp cursor), evidence graph (clinic+equipment),
-- user history (clinic+user), analytics (clinic+timestamp range)
CREATE INDEX IF NOT EXISTS idx_vt_scan_logs_clinic_timestamp
  ON vt_scan_logs (clinic_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_vt_scan_logs_clinic_equipment
  ON vt_scan_logs (clinic_id, equipment_id);

CREATE INDEX IF NOT EXISTS idx_vt_scan_logs_clinic_user
  ON vt_scan_logs (clinic_id, user_id);

-- vt_alert_acks: semi-dock notify + alert reminder sweep
CREATE INDEX IF NOT EXISTS idx_vt_alert_acks_clinic_equipment_alert
  ON vt_alert_acks (clinic_id, equipment_id, alert_type);

CREATE INDEX IF NOT EXISTS idx_vt_alert_acks_remind
  ON vt_alert_acks (remind_at)
  WHERE reminded_at IS NULL AND remind_at IS NOT NULL;
