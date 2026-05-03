-- Add immutable pricing snapshot to billing ledger.
-- Persists the full price resolution context at billing time so future
-- price changes never affect historical records.

ALTER TABLE vt_billing_ledger
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB;
