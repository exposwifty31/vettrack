-- Performance indexes for ops tables (shift_sessions, shifts, push_subscriptions,
-- scheduled_notifications, audit_logs) — previously unindexed on clinic_id paths.

-- vt_shift_sessions: open-session lookup (home dashboard, shift-chat presence)
CREATE INDEX IF NOT EXISTS idx_vt_shift_sessions_clinic_open
  ON vt_shift_sessions (clinic_id, started_at)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vt_shift_sessions_clinic_started
  ON vt_shift_sessions (clinic_id, started_at);

-- vt_shifts: shift roster lookups by clinic + date
CREATE INDEX IF NOT EXISTS idx_vt_shifts_clinic_date
  ON vt_shifts (clinic_id, date);

-- vt_push_subscriptions: push fanout (queries all subs for a clinic)
CREATE INDEX IF NOT EXISTS idx_vt_push_subscriptions_clinic
  ON vt_push_subscriptions (clinic_id);

CREATE INDEX IF NOT EXISTS idx_vt_push_subscriptions_clinic_user
  ON vt_push_subscriptions (clinic_id, user_id);

-- vt_scheduled_notifications: dedup lookup + pending sweep
CREATE INDEX IF NOT EXISTS idx_vt_scheduled_notifications_lookup
  ON vt_scheduled_notifications (clinic_id, type, user_id, equipment_id);

CREATE INDEX IF NOT EXISTS idx_vt_scheduled_notifications_pending
  ON vt_scheduled_notifications (type, scheduled_at)
  WHERE sent_at IS NULL;

-- vt_audit_logs: tenant audit list (ordered by timestamp DESC)
CREATE INDEX IF NOT EXISTS idx_vt_audit_logs_clinic_timestamp
  ON vt_audit_logs (clinic_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_vt_audit_logs_clinic_action_type
  ON vt_audit_logs (clinic_id, action_type, timestamp);
