# R-PDF-1 — Predictive readiness engine ("will you be ready") (SUB-SPEC + plan)

- **Covers:** massive-02 (spec §6.2). Read-mostly; **extends the existing Analytics console (Phase 7)** — do not add a new surface family.
- **Demand model LOCKED (owner):** v1 demand = **schedule-only** (required equipment/consumables inferred from scheduled procedures — R-PDF-1.1); **historical usage (burn-rate) is a SEPARATE term in the shortfall equation (R-PDF-1.3), never folded into demand** (so consumption is counted once). NO manual template authoring at launch. Both the schedule-only inference and the future per-procedure template logic sit **behind one demand-source interface** so templates arrive incrementally with **no rewrite**.
- **Bias:** conservative — **precision over recall**. Noisy predictions get ignored (same failure mode as a noisy alert).
- **Card contract:** RED→GREEN→verify; read-mostly guardrails per card.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate (net-new engine; explainability + precision are easy to get subtly wrong). Read-mostly, so no browser drill required. See README → "Execution driver".
- **All decisions are pinned in the cards below** (v1 adds no schema; burn-rate INCREASES required qty; trailing-14-day window; redacted `clinicId`-scoped explainability DTO; read-only PO recommendations gated on authorization) — no open choices.

## Reuse anchors (verify at build)

`server/services/operational-metrics.service.ts` (metrics aggregation) · `server/services/restock.service.ts` + `server/routes/restock.ts` + PO flow · `server/workers/expiryCheckWorker.ts` + `stagingExpiryWorker.ts` · `server/routes/analytics.ts` (extend, don't fork) · `vt_appointments` (unified schedule → demand). **New:** `server/services/readiness-forecast.service.ts`.

## Frozen guardrails (every card)

Read-mostly (no new transport) · bounded-enum telemetry if counters added · `clinicId` on **every** read · **v1 adds NO table, column, or mapping schema** — existing fields/configuration only. (The procedure-template mapping is a later addition behind the R-PDF-1.1 interface, with its own schema scope + migration **then**, not now.)

---

### R-PDF-1.1 · Demand model behind a single interface (inference-first)

- **Goal:** `DemandSource` interface with a v1 implementation returning **schedule-only demand** — required equipment/consumables from `vt_appointments` (scheduled procedures). **Burn rate is a SEPARATE input to the shortfall equation (R-PDF-1.3), NOT folded into demand** — so `burnRate × horizon` is counted exactly once and historical consumption is never double-counted. Template implementation is a *later* impl of the same interface.
- **RED:** `tests/readiness-forecast-demand.test.ts` — **demand is schedule-only: seed scheduled procedures → the inferred demand set; then VARY usage history across runs and assert the `DemandSource` result is UNCHANGED (consumption never enters schedule-only demand)**; swapping in a stub template impl through the same interface yields the same shape (interface contract test). **(The usage-history/burn-rate variation that DOES move numbers is exercised in R-PDF-1.3's shortfall fixture, not here.)**
- **Guardrail:** v1 adds **no table, column, or mapping schema** — existing fields/configuration only; no per-procedure template authoring; the interface must not leak an inference-only assumption. (Templates = a later impl of the same interface, with their own schema scope.)
- **Verify:** `pnpm test -- tests/readiness-forecast-demand.test.ts && pnpm typecheck`.

### R-PDF-1.2 · Supply model

- **Goal:** available + **ready** units (compose `equipment-readiness-rules.service.ts`) + **`availableCurrentStock` = the unreserved current on-hand quantity per demand key** (`restock`/inventory, minus reserved/allocated). `clinicId`-scoped.
- **RED:** `tests/readiness-forecast-supply.test.ts` — seeded fleet+stock → correct ready-supply counts (a not-ready unit is excluded from supply).

### R-PDF-1.3 · Shortfall join + burn-rate projection

- **Goal — shortfall equation (pinned; burn-rate INCREASES required quantity, it does not reduce shortfall):** `requiredThroughHorizon = demand(scheduleWindow) + burnRate × horizon`; `availableSupplyThroughHorizon = readySupply + availableCurrentStock + incomingStock(arrivesWithinHorizon)`; **`availableCurrentStock` = the unreserved on-hand quantity per demand key (from R-PDF-1.2) — omitting it would invent false shortfalls for consumables already in stock;** `shortfall = max(0, requiredThroughHorizon − availableSupplyThroughHorizon)`. **`incomingStock` counts ONLY units whose arrival/ETA falls within the forecast horizon — stock arriving after the horizon is excluded** (it cannot cover demand due before it lands); an **explicit per-item quantity-unit conversion** (packs→units) is applied so supply and demand are in the same unit. **Everything is computed INDEPENDENTLY per demand key (per equipment type / per consumable SKU) in that key's canonical unit — equipment unit-counts and consumable quantities are NEVER summed into one aggregate; `required`, `available`, and `shortfall` are per-key.** **Rounding is deterministic: after conversion, fractional `required` rounds UP (ceil), fractional `available` rounds DOWN (floor) — shortfall is never understated; shortfalls are ordered by descending shortfall then key id.** **Unit-consistent projection (pinned):** `burnRate` is normalized to **units-per-hour** (`burnRatePerHour = totalConsumedUnits / (14 × 24)`) and `horizon` is expressed in **hours**, so `burnRate × horizon` stays dimensionally consistent whether the horizon resolves to the default 24h or a shorter next-procedure window; the RED fixture uses this same conversion. **horizon = the next scheduled-procedure window (default 24h, in hours); burn-rate window = trailing 14 days → per-hour rate;** reserved/allocated units are excluded from `readySupply`. Conservative + explainable ("short 4 IV sets by 14:00 at current burn"); every warning carries its source rows.
- **RED:** `tests/readiness-forecast-shortfall.test.ts` — seeded schedule+stock+burn → exactly the expected shortfalls **with the sign correct** (a higher burn rate *raises* the shortfall); `max(0, …)` never yields a negative shortfall; **on-hand `availableCurrentStock` REDUCES the shortfall (a key with enough unreserved on-hand stock reports zero shortfall)**; each shortfall exposes the source appointment/stock/burn rows.

### R-PDF-1.4 · Surface (Analytics panel + PO recommendations)

- **Goal:** an Analytics console panel; a "no shortfall" clinic shows a **calm, empty** state (no false alarms). **Explainability = a redacted, `clinicId`-scoped DTO** (source-row references + counts, never raw PII). **PO recommendations are READ-ONLY** — the panel renders a recommendation; rendering/refresh **creates no PO**; a PO is created/submitted **only** through the existing explicit user confirmation + authorization checks. **No new surface family** — everything renders inside the **existing Analytics console**; **no home-surface tile in v1** (that would violate the §3 "do not add a new surface family" guardrail).
- **RED:** `tests/readiness-forecast-panel.test.tsx` — warnings render with the **redacted explainability DTO** (source-row refs + counts, no PII); **rendering or refreshing the panel writes ZERO POs** (assert no PO mutation); a PO is created **only after** the existing explicit confirmation + authorization; empty state on a healthy clinic; he+en; RTL.

### R-PDF-1.5 · Verification (acceptance bar)

- Seeded schedule + stock → engine emits exactly the expected shortfalls (precision-first, correct sign).
- Explainability panel lists source rows for each warning (redacted DTO).
- No-shortfall clinic shows the calm empty state.
- **Cross-clinic negative:** seed equivalent rows for **two** clinics; assert demand, supply, shortfalls, and explainability include **only the requested clinic's target-table rows** (every read filters the target table by `clinicId`). Applies to the demand (R-PDF-1.1), supply (R-PDF-1.2), and shortfall (R-PDF-1.3) tests, not only the panel.

## Resolved (were open decisions — now pinned)

- **Burn-rate window:** trailing **14 days** (R-PDF-1.3).
- **Procedure-template mapping:** **not in v1** — v1 uses existing fields/configuration only and adds no table/column/mapping; templates are a later impl of the R-PDF-1.1 interface with their own schema scope + migration.
