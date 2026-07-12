# R-BDF-1 — Ambient anomaly alerting on `/board` (SUB-SPEC + plan)

- **Covers:** medium-03 (spec §6.2). Board surface — glance-only, zero touch targets.
- **Coordinates with `R-M1.3`:** both write to `equipment-command-board.service.ts`. RFID `reader-offline` (from R-M1) is **one anomaly source** feeding this general anomaly pass — share the board-producer seam; don't build two.
- **Card contract:** RED→GREEN→verify; frozen board/PWA guardrails per card.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate + the board drill (frozen snapshot/telemetry surface). See README → "Execution driver".
- **All decisions are pinned in the cards below** (the fixed 3-rule v1 set + thresholds + anomaly-object shape; the single-shot dedup/reset state machine; unconditional bounded-enum telemetry; board-only fan-out) — no open choices.

## Frozen guardrails (every card)

`/api/display/snapshot` is **cache-denylisted** — do NOT add any caching to satisfy this feature · **no new transport** (anomalies derive from the snapshot already fetched, no new poll) · **bounded-enum telemetry** — anomaly types are a **closed enum** on client + `server/routes/realtime.ts`, no free-form labels · motion **clarifies, not alarms** — single-shot escalation, `prefers-reduced-motion` honored in calm mode.

## Reuse anchors (verify at build)

`server/services/equipment-command-board.service.ts` (snapshot composition — the producer seam) · `server/routes/display.ts` (`/api/display/snapshot`, denylisted) · `src/board/BoardShell.tsx` + board components · `src/board/useBoardAutoReload.ts` + the Phase-5 **calm/pressure** mode (`use-board-mode.ts`) · `server/services/equipment-readiness-rules.service.ts` (thresholds) · `shared/equipment-board.ts` (the existing `evidenceConflict` union + alert-reason slots to reuse).

---

### R-BDF-1.1 · Closed, bounded anomaly-rule set over the existing snapshot

- **Goal:** a rules pass deriving anomalies from data already in the snapshot — a **FIXED v1 closed set of exactly three high-precision rules**: `battery_critical` (device battery ≤ the critical threshold from `equipment-readiness-rules.service.ts`), `cart_unverified` (crash cart last-verified **> 7 days**), `rfid_reader_offline` (from R-M1.1d — no heartbeat within the reader-offline threshold). **No other rules in v1** (empty-dock / waitlist are a later, trust-earned expansion). **Anomaly object contract (fixed):** `{ type: <closed enum>, unitId, severity: 'calm'|'pressure', since: ISO, sourceRef: { table, id } }` — **severity per rule:** `battery_critical`→pressure, `rfid_reader_offline`→pressure, `cart_unverified`→calm; **`since`** = the condition's onset ISO from the snapshot's **server-side authoritative clock** (not client); **`sourceRef`** = the `{ table, id }` of the row that tripped the rule. The RED fixtures assert all four fields per rule.
- **RED:** `tests/board-anomaly-rules.test.ts` — seeded state that trips each of the three rules → exactly one anomaly object per trip with the correct `type`/`unitId`/`since`; a healthy clinic → none; **each rule's threshold value is asserted against its named source** (battery / 7-day verification age / heartbeat window).
- **Guardrail:** derivation lives in the board service; no new tables; no new fetch.
- **Verify:** `pnpm test -- tests/board-anomaly-rules.test.ts && pnpm typecheck`.

### R-BDF-1.2 · Board "attention" section (calm/pressure-aware, single-shot)

- **Goal:** render anomalies as **ranked** cards — **ordering (pinned):** severity (pressure > calm) → rule priority (`battery_critical` > `rfid_reader_offline` > `cart_unverified`) → `since` age (oldest first) → `unitId` (stable tie-break); a fixture with equal-priority anomalies locks the order. **calm mode** stays quiet + honors reduced-motion; **pressure mode** escalates **once** (color+motion+size) and holds — no looping flash. **Single-shot state machine (pinned):** dedup key = `(type, unitId)`; per-key states `absent → active (fire once) → cleared`; a snapshot where the condition no longer holds transitions the key to `cleared`; re-fire only on a subsequent `cleared → active`. A Code Blue push (R-CBF-1) is the one always-loud event.
- **RED:** `tests/board-attention-render.test.tsx` + `tests/board-anomaly-statemachine.test.ts` — anomalies render ranked; calm vs pressure differ; reduced-motion swaps motion for a static/cross-fade variant; **state-machine cases: initial fire; repeated identical snapshots do NOT re-fire; clear when the condition is gone; reappearance re-fires only after a clear; distinct `(type, unitId)` keys are independent; mode changes do NOT re-fire.**
- **Guardrail:** glance-only — no interactive targets added to the board.

### R-BDF-1.3 · Bounded-enum telemetry

- **Goal (mandatory in v1, not conditional):** anomaly types are a **closed enum** on both client and `server/routes/realtime.ts`, plus the `incrementMetric()` union in `server/lib/metrics.ts`. Telemetry ships with the feature — it is not "if counters are added."
- **RED:** `tests/board-anomaly-telemetry.test.ts` — the closed-enum rejection is **unconditional**: an out-of-enum anomaly type is rejected by the closed-union check on both client and server.

### R-BDF-1.4 · Verification (acceptance bar)

- Seeded anomalous state → board shows exactly the right anomaly cards; healthy clinic shows none.
- **Telemetry acceptance (mandatory):** `tests/board-anomaly-telemetry.test.ts` asserts **all three valid anomaly types are accepted + mapped through the client, `server/routes/realtime.ts`, and `incrementMetric()`**, plus the out-of-enum rejection — this command is part of the acceptance gate.
- **Snapshot stays uncached** — assert the denylist path is untouched.
- Calm vs pressure rendering spot-check (+ the board Playwright drill if rendering changed).

## Resolved (were open decisions — now pinned)

- **v1 rules + thresholds:** the fixed three (`battery_critical`, `cart_unverified` >7d, `rfid_reader_offline`) with **fixed** thresholds (not owner-configurable in v1) — R-BDF-1.1.
- **Fan-out:** **board-only for v1** (no mobile-home fan-out); a targeted mobile push is a later addition.
