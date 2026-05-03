-- Context-aware price catalog for inventory items.
-- Resolution order: exact (container+usageType) → container → usage → global.
-- Missing price must surface as PRICE_NOT_FOUND — no silent fallback.

CREATE TABLE IF NOT EXISTS vt_inventory_item_prices (
  id            TEXT         PRIMARY KEY,
  clinic_id     TEXT         NOT NULL REFERENCES vt_clinics(id)  ON DELETE RESTRICT,
  item_id       TEXT         NOT NULL REFERENCES vt_items(id)     ON DELETE RESTRICT,
  context_type  VARCHAR(20)  NOT NULL,   -- CONTAINER | USAGE | GLOBAL
  context_id    TEXT,                    -- containerId, usageType string, or NULL (GLOBAL)
  price_cents   INTEGER      NOT NULL,
  currency      VARCHAR(10)  NOT NULL DEFAULT 'ILS',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT         NOT NULL REFERENCES vt_users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vt_item_prices_item_context
  ON vt_inventory_item_prices (clinic_id, item_id, context_type);

CREATE INDEX IF NOT EXISTS idx_vt_item_prices_effective
  ON vt_inventory_item_prices (item_id, effective_from DESC);
