-- 183_vt_clinical_check_ins_open_senior_unique.sql
-- Doctor shift gate: DB backstop for the one-open-senior-per-team invariant.
-- The service's check-then-act SELECT cannot stop two concurrent isSenior
-- claims for the same (clinic, team); this partial unique index does. The
-- service maps its 23505 to SENIOR_ALREADY_ASSIGNED (mirrors the
-- ux_vt_clinical_check_ins_open_per_user pattern).

-- Pre-clean any drifted duplicates: oldest open senior per team keeps the
-- tag (same "first wins" rule buildBoardResponsibles already renders), the
-- rest are demoted in place (rows stay open as members).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY clinic_id, operational_role
           ORDER BY checked_in_at ASC, id ASC
         ) AS rn
  FROM vt_clinical_check_ins
  WHERE is_senior AND checked_out_at IS NULL
)
UPDATE vt_clinical_check_ins c
SET is_senior = false
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_vt_clinical_check_ins_open_senior_per_team
  ON vt_clinical_check_ins (clinic_id, operational_role)
  WHERE is_senior AND checked_out_at IS NULL;
