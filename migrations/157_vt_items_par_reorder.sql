-- Inventory item par level + reorder point (Stage 5 item-detail).
--
-- Additive, nullable columns on vt_items. `par_level` is the target on-hand
-- quantity across all containers; `reorder_point` is the on-hand threshold at
-- or below which the item-detail screen surfaces a reorder cue. Both null =
-- untracked (the screen renders the plain on-hand view). No backfill required.
ALTER TABLE vt_items ADD COLUMN IF NOT EXISTS par_level integer;
ALTER TABLE vt_items ADD COLUMN IF NOT EXISTS reorder_point integer;
