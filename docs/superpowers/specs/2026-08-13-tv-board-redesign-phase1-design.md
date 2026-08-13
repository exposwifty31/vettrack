# TV Board Redesign — Phase 1 (Presentation Layer) — Approved Design

**Date:** 2026-08-13 · **Owner decision session:** approved 2026-08-13 · **Owner spec review applied:** 2026-08-13 (rev 2)
**Scope:** `/board` Command Center display only — presentation layer on **existing** snapshot data. Zero server changes.
**Research base:** model-council reports in `docs/design/tv-board-redesign/` (council-claude-fable-5.md, council-gpt-5-6-sol.md, council-synthesis.md).
**Successor:** Phase 2 (separate spec, after Phase 1 stabilizes) adds new rotation views — shifts now/next, equipment location/custody — with their snapshot extensions.
**Sequencing:** PR #178 (10-foot TV mode, `?tv=1` + D-pad) merges FIRST; Phase 1 builds on top of it.

---

## Owner decisions (locked 2026-08-13)

1. **Approvals banner ("17 הצעות ממתינות לאישור") is CUT from the board entirely** — no chip, no fallback. Approvals happen at the desk; TV viewers cannot act on them. Cutting it also deletes the separate `actionProposals` poller from the kiosk (one less request loop, one less failure mode).
2. **All-clear presentation = the synthesis middle path.** Tinted state strip readable peripherally + compact evidence panel ("12 מתוך 12 · נבדק כעת") + monitored-equipment tiles. No decorative motion; the single sanctioned ambient signal is a heartbeat dot pulsing once per successful poll.
3. **Content architecture = fixed anchor + rotating stage.** State strip, responsibles band, and freshness chip never move; only the central stage rotates (~45 s). **Rotation locks on alert** and enters **single-view mode when the Ops view has nothing to show** (see §2).
4. **Responsibles = names always, aggregate when empty** — precise fill mapping in §4.
5. **Execution = two phases** (this spec is Phase 1). Phase 1 touches only `src/features/command-board/**` + `src/board/**` + locales; Phase 2 is a separate spec.

---

## 1. Board state machine

New pure module `resolveBoardState(snapshot, connection): BoardState`, derived client-side from the existing `/api/display/snapshot` payload plus the poll-connection tracker.

### Priority zero — Code Blue (frozen, outside the machine)

The existing Code Blue path is **preserved byte-for-byte and sits ABOVE `resolveBoardState` entirely**: `CommandBoardScreen` keeps its early return to the full-screen `CodeBlueOverlay` when `snapshot.codeBlueSession` is active, the poll keeps its 2 s acceleration during a session, and `useBoardAutoReload` keeps keying on that field. `resolveBoardState` is only ever consulted when no Code Blue session is active. A `stale` takeover can therefore never mask an active resuscitation — the overlay wins unconditionally. (Frozen surface; no Phase-1 change may touch this ordering.)

### Priority order (first match wins, evaluated only outside Code Blue)

| State | Condition | Full-screen treatment |
|---|---|---|
| `stale` / `offline` | connection tracker past threshold (§6). `offline` (all polls failing) shares the same takeover layout as `stale` with harsher copy ("אין חיבור לשרת") | Amber/red takeover: "אין נתונים עדכניים", last-good time, **last-known values retained and labeled "מצב אחרון ידוע"** — never reset to zeros |
| `unconfigured` | zero critical equipment defined | Amber takeover: neutral outlined icon, "לא הוגדר ציוד קריטי", deictic hint "יש להגדיר בקונסולת הניהול". **Never shows ✓.** Ordering note: `unconfigured` outranks `alert` safely because alert inputs (equipment availability, power alerts) derive from configured critical equipment — the two cannot meaningfully coexist; if they ever do, surfacing the configuration hole first is the fail-cautious choice |
| `alert` | any critical equipment unavailable OR active power alerts > 0. **Enter instantly; exit only after ~30 s of continuous clear** (adopts the existing exit-only hysteresis pattern from `useBoardMode`) so a flapping unit cannot toggle the rotation lock and stage layout | Stage locks on ranked exception cards |
| `attention` | non-zero waitlist/staging, or responsibles gaps **while `currentShift` is non-empty** (the snapshot's shift data is the schedule source — no hardcoded clock) | Neutral stage + amber accents on the specific chips |
| `all_clear` | none of the above | Middle-path composition (§3) |

### Relationship to the existing state machines (explicit)

- **`useBoardMode` (calm/pressure) is replaced** by `resolveBoardState` as the single layout driver. Its exit-only 30 s hysteresis pattern is absorbed into `alert` exit. The `alert` condition is **deliberately stricter** than the old pressure doctrine (threshold of 3): pressure was a density heuristic; `alert` is a safety state — one unavailable critical unit is enough.
- **`useBoardAnomalyStateMachine` coexists unchanged** — it keeps firing single-shot anomaly surfacing inside the stage; it does not drive layout.

### Absent ≠ zero (binding)

Every snapshot block (`commandBoard`, `responsibles`, `power`, `waitlist`, `staging`) is optional and degrades independently ("never assume presence" — `shared/equipment-board.ts`). An **absent/undefined block renders a muted "unknown" treatment — never zeros**: `power === undefined` must not render "0 התראות"; `responsibles === null` (server-side build failure) renders a muted "נתוני אחראים אינם זמינים" — which is NOT the same as "nobody signed in". These cases are first-class unit tests (§7).

### State provenance rule (binding)

Every positive claim shows its evidence — configured-count, last-check time. A blank database must never be indistinguishable from a healthy clinic. Loading keeps the previous known state with "מתעדכן…" — never a blank board, never zeros.

## 2. Layout — anchor + rotating stage

1920×1080 design canvas, all meaningful content inside a 5% safe inset. RTL structural: reading starts top-right.

- **Top band (~13%):** right → department wordmark + operational summary ("12/12 זמינים" as a semantic phrase); left → clock (48–64 px, no seconds) + freshness chip + heartbeat dot.
- **State strip (full width):** background tint encodes global state (desaturated green / amber / red) at ~15% opacity over base — **opacity to be validated on the physical TV from the corridor before locking** (runbook item).
- **Main stage (~60%):** Phase 1 has two views — **Equipment view** (all-clear evidence composition or alert exception cards) and **Ops view** (waitlist/staging detail when non-zero + the **current-shift strip**: the on-shift staff content `CommandBoard` renders today from `snapshot.currentShift`, relocated here — it is NOT dropped in Phase 1; Phase 2's dedicated shifts view supersedes it). 300 ms cross-fade every ~45 s. **Rotation pauses:** in `alert` (locked on exceptions), during takeover states, and in **single-view mode** — when the Ops view has nothing to show (zero waitlist/staging AND empty `currentShift`), the stage stays on the Equipment view instead of rotating to a near-empty screen. Note: single-view mode removes rotation as burn-in relief exactly when static-overnight risk peaks — the 1–2 px layout drift and night dimming carry that load alone (stated deliberately).
- **Bottom band (~25%, fixed):** three equal cards — אחראים (§4), חשמל, עמדות עגינה. Semantic phrasing; red only when alerts > 0; absent block → muted unknown (§1).
- Zero-value counters never render as full-width empty bars — compact top-band chips, expanding into the stage only when non-zero.
- Exception cards: name 40 px / location 32 px / elapsed-downtime timer 64 px; severity then elapsed-time sort; >3 → "+N תקלות נוספות".

## 3. Visual system

- **Type (Heebo — already loaded at 400–700 in index.html; use 500–700 only):** caption 28 px (absolute floor) · body 32 · title 40 · headline 64 · display 120–160. Hebrew gets headroom: when in doubt, one step up. Line-height ~1.15 display / 1.25–1.35 labels. `font-variant-numeric: tabular-nums lining-nums` on every count and the clock.
- **Number update granularity (no ticking):** numbers never count-animate, and no on-screen number updates per-second. Freshness renders in coarse buckets ("עודכן כעת" / "לפני פחות מדקה" / "לפני N דקות"); elapsed-downtime timers update at minute granularity ("12 דק׳").
- **Palette (elevation ladder, no pure black):** base ≈ `#0F141A` → card ≈ `#161D26` → focal ≈ `#1C2530`; primary text ≈ `#F2F5F8`, secondary ≈ `#A9B4C0` (verified ≈8:1 on card, ≈7.3:1 on focal). Contrast target **7:1**. No gradients/glass/glow; no hairline borders; 16–24 px radii; exception cards get a 6–8 px severity edge rail.
- **Status semantics:** red exclusively for active problems (the red "0 התראות חשמל" is corrected to neutral); every status = hue + icon shape + Hebrew word; success mint sparingly.

## 4. Responsibles panel v2 — precise fill mapping

Consumes the existing `responsibles` snapshot key. Actual shape: three doctor blocks (each `senior` + `members[]`), `seniorTechnician`, `equipmentCoordinator` (status enum `auto | confirmed | fallback_senior | needs_confirmation | unresolved`).

**Fill mapping (binding):**

| Slot | Counts as "סומן" (filled) | Display |
|---|---|---|
| Doctor block | `senior` present OR `members` non-empty | Senior name (+ badge); no senior but members → member count ("2 רופאים") with an **amber "ללא בכיר"** accent — filled but flagged |
| Senior technician | present | Name |
| Equipment coordinator | status `auto` or `confirmed` | Name, neutral/green |
| Equipment coordinator | status `fallback_senior` or `needs_confirmation` | Name, **amber** — counts as filled but visibly provisional |
| Equipment coordinator | status `unresolved` | Empty |

- ≥1 slot filled: named slots at 32 px; empty slots grouped into one muted line.
- All five empty: single aggregate row "0/5 סומנו למשמרת" + segmented 5-part progress bar filling **LTR** (Material 3's Hebrew exception), role names at caption size. The "N/5" numerator = count of filled slots per the table above.
- `responsibles === null` (build failure): the whole card renders the muted-unknown treatment (§1) — never the 0/5 aggregate.
- Copy names the shift ("אף אחראי לא סומן למשמרת הבוקר") rather than bare "לא סומן" repetition.

## 5. RTL / bidi implementation rules

- `dir="rtl"` structural; CSS **logical properties only**.
- Bidi-isolate every mixed/numeric token: `12/12`, clock, equipment IDs, "בכיר ICU".
- Never letter-space Hebrew; no italics; no synthetic bold.
- Do not mirror: checkmarks, clocks, power/plug icons, refresh. Progress bars fill LTR (Hebrew exception).

## 6. Data, freshness, kiosk

- **Zero server changes.** Same poll of `/api/display/snapshot` (frozen surface — untouched), including its **2 s acceleration during Code Blue**; all states derived client-side.
- **Connection state machine with hysteresis:** `live → delayed → stale → offline`; escalation requires multiple consecutive missed polls. Thresholds are **cadence-aware constants** (counted in missed polls, not wall-time, since the poll interval is 5 s normally and 2 s during Code Blue): delayed ≈ 4 missed polls, stale ≈ the 2-minute equivalent — tuned later. Freshness chip escalates neutral → amber → the `stale` takeover. On recovery: "החיבור חודש" for ~5 s, one non-looping fade.
- Three timestamps distinguished: event time, last successful poll, render time — only the first two determine trust.
- **Kiosk:** ops runbook note (dedicated fullscreen profile; Vivid/sharpening/motion-smoothing off; brightness ≤60%; **validate state-strip tint visibility from the corridor before locking opacity**). Long-session hygiene already covered by the existing `useBoardAutoReload`. Client-side night dimming outside clinic hours via a documented clock constant (schedule data has no server source in Phase 1); **`alert` and Code Blue override dimming unconditionally**. Burn-in hygiene: night dim + rotation + slow 1–2 px layout drift.

## 7. Testing

- Unit: `resolveBoardState` — every transition incl. cadence-aware hysteresis, **flap suppression** (rapid alert↔clear toggling holds `alert` until 30 s continuous clear), priority order (incl. unconfigured-beats-alert), last-known-value retention, **absent-block handling** (undefined `power` → unknown not zeros; null `responsibles` → unavailable not empty), and Code-Blue-preemption (machine never consulted while a session is active).
- Component: one test per full-screen state + responsibles fill-mapping matrix (incl. members-without-senior amber, coordinator enum states) + freshness escalation + **rotation lock on alert entry/exit + single-view mode**.
- Visual regression: Playwright screenshots at 1920×1080 for the full-screen states (behind the `PW_SUITE` allowlist).
- **Frozen-surface guard as code, not review:** an ESLint `no-restricted-imports`/path rule (or equivalent lint check) preventing Phase-1 board modules from importing/patching the snapshot route client, SSE internals, or the Code Blue overlay ordering — cheap and durable.

## Out of scope (Phase 2+)

- Shifts now/next dedicated view; equipment location/custody view; any snapshot extension.
- Physical TV procurement; native TV app — the board remains a web kiosk.
- Any interactivity on the TV. Configuration, approvals, sign-ins stay on the console/mobile.
