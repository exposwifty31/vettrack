-- PR-20 (finding IB-03): negative-inventory database guard.
--
-- On-hand stock quantities must never be negative. The service layer
-- already floors decrements (dispense.service.ts via Math.min;
-- inventory.service.ts via GREATEST(0, ...)), but nothing enforced the
-- invariant at the database level, so any unfloored future write path —
-- or a concurrent dispense race — could drive stock below zero.
--
-- This migration adds CHECK constraints as the last-resort safety net:
--   vt_container_items.quantity         >= 0
--   vt_containers.current_quantity      >= 0
--
-- Existing rows are sanitised to 0 first so the constraint can be added
-- cleanly on a database that may already hold a stray negative value.
-- The clamp is the same correction the constraint will enforce going
-- forward; it cannot lose legitimate (non-negative) stock.

UPDATE vt_container_items SET quantity = 0 WHERE quantity < 0;
UPDATE vt_containers SET current_quantity = 0 WHERE current_quantity < 0;

ALTER TABLE vt_container_items
  ADD CONSTRAINT vt_container_items_quantity_non_negative
  CHECK (quantity >= 0);

ALTER TABLE vt_containers
  ADD CONSTRAINT vt_containers_current_quantity_non_negative
  CHECK (current_quantity >= 0);
