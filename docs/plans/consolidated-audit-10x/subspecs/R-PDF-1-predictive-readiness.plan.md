# R-PDF-1 — Predictive readiness engine ("will you be ready") (SUB-SPEC + plan)

- **Covers:** massive-02 (spec §6.2). Read-mostly; **extends the existing Analytics console (Phase 7)** — do not add a new surface family.
- **Demand model LOCKED (owner):** v1 = **inference from historical usage (burn-rate)**, NO manual template authoring at launch — but put inference and the future per-procedure template logic **behind one demand-source interface** so templates arrive incrementally with **no rewrite**.
- **Bias:** conservative — **precision over recall**. Noisy predictions get ignored (same failure mode as a noisy alert).
- **Card contract:** RED→GREEN→verify; read-mostly guardrails per card.

## Reuse anchors (verify at build)
`server/services/operational-metrics.service.ts` (metrics aggregation) · `server/services/restock.service.ts` + `server/routes/restock.ts` + PO flow · `server/workers/expiryCheckWorker.ts` + `stagingExpiryWorker.ts` · `server/routes/analytics.ts` (extend, don't fork) · `vt_appointments` (unified schedule → demand). **New:** `server/services/readiness-forecast.service.ts`.

## Frozen guardrails (every card)
Read-mostly (no new transport) · bounded-enum telemetry if counters added · `clinicId` on **every** read · no schema mutation for v1 (optional small procedure→requirement mapping decided in PDF.1).

---

### R-PDF-1.1 · Demand model behind a single interface (inference-first)
- **Goal:** `DemandSource` interface with a v1 **historical-inference** implementation: from `vt_appointments` (scheduled procedures) + trailing usage, derive required equipment/consumables. Template implementation is a *later* impl of the same interface.
- **RED:** `tests/readiness-forecast-demand.test.ts` — seeded schedule + usage history → the inferred demand set; swapping in a stub template impl through the same interface yields the same shape (interface contract test).
- **Guardrail:** no per-procedure template authoring in v1; the interface must not leak an inference-only assumption.
- **Verify:** `pnpm test -- tests/readiness-forecast-demand.test.ts && pnpm typecheck`.

### R-PDF-1.2 · Supply model
- **Goal:** available + **ready** units (compose `equipment-readiness-rules.service.ts`) + current stock (`restock`/inventory). `clinicId`-scoped.
- **RED:** `tests/readiness-forecast-supply.test.ts` — seeded fleet+stock → correct ready-supply counts (a not-ready unit is excluded from supply).

### R-PDF-1.3 · Shortfall join + burn-rate projection
- **Goal:** demand − supply + burn-rate projection → conservative, explainable shortfalls (e.g. "short 4 IV sets by 14:00 at current burn"). **Every warning carries its source rows.**
- **RED:** `tests/readiness-forecast-shortfall.test.ts` — seeded schedule+stock+burn → exactly the expected shortfalls; each shortfall exposes the source appointment/stock/burn rows.
- **Open decision:** burn-rate window (trailing 7/14/30d) — pick one, make it explicit.

### R-PDF-1.4 · Surface (Analytics panel + PO recommendations)
- **Goal:** an Analytics console panel + **pre-filled PO recommendations** that flow into the existing `restock`/PO path; explainability panel lists the source rows per warning; a "no shortfall" clinic shows a **calm, empty** state (no false alarms). Optional home-surface summary tile.
- **RED:** `tests/readiness-forecast-panel.test.tsx` — warnings render with source rows; PO recommendation pre-fills the existing flow; empty state on a healthy clinic; he+en; RTL.

### R-PDF-1.5 · Verification (acceptance bar)
- Seeded schedule + stock → engine emits exactly the expected shortfalls (precision-first).
- Explainability panel lists source rows for each warning.
- No-shortfall clinic shows the calm empty state.

## Open decisions (confirm at build)
- Burn-rate window (7/14/30d).
- Optional `equipment.requires[]` / procedure-template mapping to model demand cleanly — decide during PDF.1 (default: pure inference, no new table).
