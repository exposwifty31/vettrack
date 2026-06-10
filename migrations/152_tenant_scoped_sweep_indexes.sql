-- Rebuild sweep/lookup indexes with clinic_id as leading key for tenant isolation.

DROP INDEX IF EXISTS idx_vt_alert_acks_remind;
CREATE INDEX idx_vt_alert_acks_remind
  ON vt_alert_acks (clinic_id, remind_at)
  WHERE reminded_at IS NULL AND remind_at IS NOT NULL;

DROP INDEX IF EXISTS idx_vt_scheduled_notifications_pending;
CREATE INDEX idx_vt_scheduled_notifications_pending
  ON vt_scheduled_notifications (clinic_id, type, scheduled_at)
  WHERE sent_at IS NULL;

DROP INDEX IF EXISTS idx_vt_appointments_acknowledged_user;
CREATE INDEX idx_vt_appointments_acknowledged_user
  ON vt_appointments (clinic_id, acknowledged_user_id)
  WHERE acknowledged_user_id IS NOT NULL;
