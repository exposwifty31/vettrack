-- Partial sweep-anchor index for the last-swept-per-room read path
-- (docking P3 pre-PR review — DB re-review MEDIUM finding).
--
-- server/routes/rooms.ts's lastSweptByRoom() runs, on every GET /api/rooms
-- (the rooms-list page, one of the hottest reads):
--   SELECT DISTINCT ON (e.home_room_id) ...
--   FROM vt_equipment_anchors a JOIN vt_equipment e ...
--   WHERE a.clinic_id = $1 AND a.source = 'sweep'
--   ORDER BY e.home_room_id, a.asserted_at DESC
-- vt_equipment_anchors is append-only and NEVER purged (see
-- 165_equipment_anchors.sql), so with only the existing
-- idx_vt_equipment_anchors_clinic_equipment_asserted (no source predicate),
-- the planner Seq-Scans the clinic's entire sweep-anchor history and the cost
-- grows monotonically with total historical sweep count — not with current
-- room/equipment count. EXPLAIN confirmed a Seq Scan + Sort on this path.
--
-- This partial index prunes to source='sweep' rows in (clinic, recency)
-- order, so the anchor side becomes an index scan over just the sweep
-- anchors. Additive + idempotent (new index only, IF NOT EXISTS); no table
-- rewrite, no lock-staging needed.

CREATE INDEX IF NOT EXISTS idx_vt_equipment_anchors_clinic_sweep_asserted
  ON vt_equipment_anchors (clinic_id, asserted_at DESC)
  WHERE source = 'sweep';
