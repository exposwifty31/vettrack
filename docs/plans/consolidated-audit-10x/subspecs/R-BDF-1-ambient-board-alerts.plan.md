# R-BDF-1 — Ambient anomaly alerting on `/board` (SUB-SPEC + plan)

- **Covers:** medium-03 (spec §6.2). Board surface — glance-only, zero touch targets.
- **Coordinates with `R-M1.3`:** both write to `equipment-command-board.service.ts`. RFID `reader-offline` (from R-M1) is **one anomaly source** feeding this general anomaly pass — share the board-producer seam; don't build two.
- **Card contract:** RED→GREEN→verify; frozen board/PWA guardrails per card.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate + the board drill (frozen snapshot/telemetry surface). See README → "Execution driver".
- **Review resolutions (decisions pinned, not open):**
  1. **v1 rule set is FIXED:** `battery_critical`, `cart_unverified`, `rfid_reader_offline` — three high-precision rules with fixed thresholds. R-BDF-1.1's RED test is normative against exactly these; more rules are a later expansion.
  2. **Single-shot state machine:** dedup key = `(anomalyType, unitId)`; per-key states `absent → active (fire once) → cleared`; re-fire only after a `cleared` transition; a snapshot where the condition no longer holds transitions the key to `cleared`.
  3. **Telemetry is in-scope for v1** (not conditional): anomaly types are a closed enum on client + `server/routes/realtime.ts`; R-BDF-1.3's closed-enum rejection test is unconditional.

## Frozen guardrails (every card)

`/api/display/snapshot` is **cache-denylisted** — do NOT add any caching to satisfy this feature · **no new transport** (anomalies derive from the snapshot already fetched, no new poll) · **bounded-enum telemetry** — anomaly types are a **closed enum** on client + `server/routes/realtime.ts`, no free-form labels · motion **clarifies, not alarms** — single-shot escalation, `prefers-reduced-motion` honored in calm mode.

## Reuse anchors (verify at build)

`server/services/equipment-command-board.service.ts` (snapshot composition — the producer seam) · `server/routes/display.ts` (`/api/display/snapshot`, denylisted) · `src/board/BoardShell.tsx` + board components · `src/board/useBoardAutoReload.ts` + the Phase-5 **calm/pressure** mode (`use-board-mode.ts`) · `server/services/equipment-readiness-rules.service.ts` (thresholds) · `shared/equipment-board.ts` (the existing `evidenceConflict` union + alert-reason slots to reuse).

---

### R-BDF-1.1 · Closed, bounded anomaly-rule set over the existing snapshot

- **Goal:** a rules pass deriving anomalies from data already in the snapshot — a **closed set** of rule types: `empty_dock_too_long`, `battery_critical`, `cart_unverified`, `waitlist_backing_up`, `rfid_reader_offline` (from R-M1). Start with a **few high-precision rules**; expand once trusted.
- **RED:** `tests/board-anomaly-rules.test.ts` — seeded anomalous state → exactly the right anomaly objects; a healthy clinic → none. Each rule's threshold asserted.
- **Guardrail:** derivation lives in the board service; no new tables; no new fetch.
- **Verify:** `pnpm test -- tests/board-anomaly-rules.test.ts && pnpm typecheck`.

### R-BDF-1.2 · Board "attention" section (calm/pressure-aware, single-shot)

- **Goal:** render anomalies as calm, ranked cards; **calm mode** stays quiet + honors reduced-motion; **pressure mode** escalates **once** (color+motion+size) and holds — no looping flash. A Code Blue push (R-CBF-1) is the one always-loud event.
- **RED:** `tests/board-attention-render.test.tsx` — anomalies render ranked; calm vs pressure differ; reduced-motion swaps motion for a static/cross-fade variant.
- **Guardrail:** glance-only — no interactive targets added to the board.

### R-BDF-1.3 · Bounded-enum telemetry

- **Goal:** if counters are added, anomaly types are a closed enum on both client and `server/routes/realtime.ts` (+ `incrementMetric()` union in `server/lib/metrics.ts`).
- **RED:** `tests/board-anomaly-telemetry.test.ts` — an out-of-enum anomaly type is rejected by the closed-union check.

### R-BDF-1.4 · Verification (acceptance bar)

- Seeded anomalous state → board shows exactly the right anomaly cards; healthy clinic shows none.
- **Snapshot stays uncached** — assert the denylist path is untouched.
- Calm vs pressure rendering spot-check (+ the board Playwright drill if rendering changed).

## Open decisions (confirm at build)

- Which anomaly rules ship v1, and their thresholds — owner-configurable or fixed.
- Do anomalies also fan out to a role's mobile home, or board-only for v1 (recommended board-only).
