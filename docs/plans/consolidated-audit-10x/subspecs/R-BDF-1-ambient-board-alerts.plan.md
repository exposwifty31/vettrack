# R-BDF-1 — Ambient anomaly alerting on `/board` (SUB-SPEC + plan)

- **Covers:** medium-03 (spec §6.2). Board surface — glance-only, zero touch targets.
- **Coordinates with `R-M1.3`:** both write to `equipment-command-board.service.ts`. RFID `reader-offline` (from R-M1) is **one anomaly source** feeding this general anomaly pass — share the board-producer seam; don't build two.
- **Card contract:** RED→GREEN→verify; frozen board/PWA guardrails per card.
- **Tier (model routing):** **O +R** — Opus + `code-reviewer` gate + the board drill (frozen snapshot/telemetry surface). See README → "Execution driver".
- **All decisions are pinned in the cards below** (the fixed 3-rule v1 set + thresholds + anomaly-object shape; the single-shot dedup/reset state machine; unconditional bounded-enum telemetry; board-only fan-out) — no open choices.

## Frozen guardrails (every card)

`/api/display/snapshot` is **cache-denylisted** — do NOT add any caching to satisfy this feature · **no new transport** (anomalies derive from the snapshot already fetched, no new poll) · **bounded-enum telemetry** — anomaly types are a **closed enum** on client + `server/routes/realtime.ts`, no free-form labels · motion **clarifies, not alarms** — single-shot escalation, `prefers-reduced-motion` honored in **both calm AND pressure modes** (pressure still escalates via color + size but swaps its motion for a static/non-animated variant when reduced-motion is set).

## Reuse anchors (verify at build)

`server/services/equipment-command-board.service.ts` (snapshot composition — the producer seam) · `server/routes/display.ts` (`/api/display/snapshot`, denylisted) · `src/board/BoardShell.tsx` + board components · `src/board/useBoardAutoReload.ts` + the Phase-5 **calm/pressure** mode (`use-board-mode.ts`) · `server/services/equipment-readiness-rules.service.ts` (thresholds) · `shared/equipment-board.ts` (the existing `evidenceConflict` union + alert-reason slots to reuse).

---

### R-BDF-1.1 · Closed, bounded anomaly-rule set over the existing snapshot

- **Goal:** a rules pass deriving anomalies from data already in the snapshot — a **FIXED v1 closed set of exactly three high-precision rules**, each with an **explicit boundary convention (equality behavior pinned so impl and fixtures agree)**: `battery_critical` (device battery **≤** the critical threshold from `equipment-readiness-rules.service.ts` — **at exactly the threshold it fires**), `cart_unverified` (crash cart last-verified age **> 7 days** — **strictly greater; exactly 7d does NOT fire**), `rfid_reader_offline` (from R-M1.1d — heartbeat age **> the reader-offline threshold** — **strictly greater; exactly at the window does NOT fire**). **No other rules in v1** (empty-dock / waitlist are a later, trust-earned expansion). **Anomaly object contract (fixed):** `{ type: <closed enum>, unitId, severity: 'calm'|'pressure', since: ISO, sourceRef: { table, id } }` — **severity per rule:** `battery_critical`→pressure, `rfid_reader_offline`→pressure, `cart_unverified`→calm; **`since`** = the condition's **first-observed** ISO. **Backing store (pinned — no new table, per the guardrail):** where the onset is **derivable from an existing snapshot timestamp** it is computed deterministically and survives restart/scale-out — `cart_unverified` → `lastVerifiedAt + 7d`; `rfid_reader_offline` → `lastReaderHeartbeat + threshold`. Only `battery_critical` has no onset in the snapshot, so its `since` is tracked by the board producer's single-shot state machine (R-BDF-1.2) in **process-local, volatile memory** (the `(type, unitId)` `absent→active` transition time). **Volatile means:** on process restart or on a fresh scale-out instance, a still-active `battery_critical` re-anchors `since` to the current observation time (onset history is not persisted) — acceptable because `since` is an advisory glance-board hint, **not** an SLA/audit clock. The stateless snapshot is never assumed to carry onset; **`sourceRef`** = the `{ table, id }` of the row that tripped the rule. The RED fixtures assert **all FIVE fields** (`type`, `unitId`, `severity`, `since`, `sourceRef`) per rule.
- **RED:** `tests/board-anomaly-rules.test.ts` — seeded state that trips each of the three rules → exactly one anomaly object per trip with the correct `type`/`unitId`/`severity`/`since`/`sourceRef` (**`severity` per the rule mapping; `sourceRef` = the exact `{ table, id }` of the tripping row**); a healthy clinic → none; **each rule's threshold value is asserted against its named source** (battery / 7-day verification age / heartbeat window), **and the equality boundary is asserted per rule** (battery exactly at threshold → fires; cart last-verified exactly 7d → does NOT fire; heartbeat exactly at the window → does NOT fire). **`since` stability — a repeated snapshot with the condition still active keeps the ORIGINAL `since` (onset), not the later observation time; a cleared-then-reappeared condition gets a NEW `since`.** **Cross-clinic isolation — clinic A's producer, given clinic B's tripping rows, derives ZERO anomalies (every anomaly-source query filters by `clinicId`).**
- **Guardrail:** derivation lives in the board service; **every anomaly-source query filters by the board's `clinicId`** (no cross-clinic leakage); no new tables; no new fetch.
- **Verify:** `pnpm test -- tests/board-anomaly-rules.test.ts` + **`npx tsc --noEmit`** + **`pnpm typecheck`** (the repo command — also covers the server tsconfig) + full `pnpm test` + **the board Playwright drill (mandatory — this card changes board rendering)**.

### R-BDF-1.2 · Board "attention" section (calm/pressure-aware, single-shot)

- **Goal:** render anomalies as **ranked** cards — **ordering (pinned):** severity (pressure > calm) → rule priority (`battery_critical` > `rfid_reader_offline` > `cart_unverified`) → `since` age (oldest first) → `unitId` (stable tie-break); a fixture with equal-priority anomalies locks the order. **calm mode** stays quiet + honors reduced-motion; **pressure mode** escalates **once** (color+motion+size) and holds — no looping flash. **Single-shot state machine (pinned):** dedup key = `(type, unitId)`; per-key states `absent → active (fire once) → cleared`; a snapshot where the condition no longer holds transitions the key to `cleared`; re-fire only on a subsequent `cleared → active`. A Code Blue push (R-CBF-1) is the one always-loud event.
- **RED:** `tests/board-attention-render.test.tsx` + `tests/board-anomaly-statemachine.test.ts` — anomalies render ranked; calm vs pressure differ; reduced-motion swaps motion for a static/cross-fade variant **in calm AND in pressure (pressure + reduced-motion still escalates color/size but with no animation)**; **state-machine cases: initial fire; repeated identical snapshots do NOT re-fire; clear when the condition is gone; reappearance re-fires only after a clear; distinct `(type, unitId)` keys are independent; mode changes do NOT re-fire.**
- **Guardrail:** glance-only — no interactive targets added to the board.

### R-BDF-1.3 · Bounded-enum telemetry

- **Goal (mandatory in v1, not conditional):** anomaly types are a **closed enum** on both client and `server/routes/realtime.ts`, plus the `incrementMetric()` union in `server/lib/metrics.ts`. Telemetry ships with the feature — it is not "if counters are added."
- **RED:** `tests/board-anomaly-telemetry.test.ts` — the closed-enum rejection is **unconditional**: an out-of-enum anomaly type is rejected by the closed-union check on both client and server.

### R-BDF-1.4 · Verification (acceptance bar)

- Seeded anomalous state → board shows exactly the right anomaly cards; healthy clinic shows none.
- **Telemetry acceptance (mandatory):** `tests/board-anomaly-telemetry.test.ts` asserts **all three valid anomaly types are accepted + mapped through the client, `server/routes/realtime.ts`, and `incrementMetric()`**, plus the out-of-enum rejection — this command is part of the acceptance gate.
- **Snapshot stays uncached** — assert the denylist path is untouched.
- Calm vs pressure rendering spot-check + the board Playwright drill (**mandatory — this card changes board rendering**; the exact drill/command per R-BDF-1.1's Verify).

## Resolved (were open decisions — now pinned)

- **v1 rules + thresholds:** the fixed three (`battery_critical`, `cart_unverified` >7d, `rfid_reader_offline`) with **fixed** thresholds (not owner-configurable in v1) — R-BDF-1.1.
- **Fan-out:** **board-only for v1** (no mobile-home fan-out); a targeted mobile push is a later addition.
