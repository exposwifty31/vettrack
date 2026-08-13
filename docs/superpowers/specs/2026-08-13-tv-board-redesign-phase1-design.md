# TV Board Redesign — Phase 1 (Presentation Layer) — Approved Design

**Date:** 2026-08-13 · **Owner decision session:** approved 2026-08-13
**Scope:** `/board` Command Center display only — presentation layer on **existing** snapshot data. Zero server changes.
**Research base:** model-council reports in `docs/design/tv-board-redesign/` (council-claude-fable-5.md, council-gpt-5-6-sol.md, council-synthesis.md), which analyzed the live board screenshot at 10-foot-UI, digital-signage, RTL, and clinical-safety standards.
**Successor:** Phase 2 (separate spec, after Phase 1 stabilizes) adds new rotation views — shifts now/next, equipment location/custody — with their snapshot extensions.

---

## Owner decisions (locked 2026-08-13)

1. **Approvals banner ("17 הצעות ממתינות לאישור") comes OFF the board.** Approvals happen at the desk regardless of the TV; the banner is an administrative queue that dilutes the clinical hierarchy. At most a quiet utility chip in the top band — never a hero element.
2. **All-clear presentation = the synthesis middle path.** Tinted state strip readable peripherally from the corridor + compact evidence panel ("12 מתוך 12 · נבדק כעת") + monitored-equipment tiles. No decorative motion; the single sanctioned ambient signal is a small heartbeat dot that pulses once per successful poll.
3. **Content architecture = fixed anchor + rotating stage.** State strip, responsibles band, and freshness chip are always in the same place; only the central stage rotates gently between views (~45 s). **Rotation locks on alert.**
4. **Responsibles = names always, aggregate when empty.** Signed-in slots show names at readable size; a fully-empty panel collapses five gray "לא סומן" rows into one aggregate line ("0/5 סומנו למשמרת") + a segmented progress bar that fills **left-to-right** (Material 3's Hebrew exception within RTL). Mixed state: filled slots by name, empty ones grouped.
5. **Execution = two phases** (this spec is Phase 1). Phase 1 touches only `src/features/command-board/**` + `src/board/**` + locales; Phase 2 is a separate spec for new content views + snapshot extensions.

---

## 1. Board state machine

New pure module `resolveBoardState(snapshot, connection): BoardState`, derived client-side from the existing `/api/display/snapshot` payload plus the poll-connection tracker.

Priority order (first match wins):

| State | Condition | Full-screen treatment |
|---|---|---|
| `stale` | connection tracker past staleness threshold (see §6) | Amber/red takeover: "אין נתונים עדכניים", last-good time, **last-known values retained and labeled "מצב אחרון ידוע"** — never reset to zeros |
| `unconfigured` | zero critical equipment defined | Amber takeover: neutral outlined icon, "לא הוגדר ציוד קריטי", deictic hint "יש להגדיר בקונסולת הניהול". **Never shows ✓** — resolves the current contradiction where "כל הציוד הקריטי זמין" renders beside "אין ציוד קריטי מוגדר" |
| `alert` | any critical equipment unavailable OR active power alerts > 0 | Stage locks (rotation paused) on ranked exception cards |
| `attention` | non-zero waitlist/staging, or responsibles gaps during shift hours | Neutral stage + amber accents on the specific chips |
| `all_clear` | none of the above | Middle-path composition (§3) |

**State provenance rule (binding):** every positive claim shows its evidence — configured-count, last-check time. A blank database must never be indistinguishable from a healthy clinic.

Loading keeps the previous known state with "מתעדכן…" — never a blank board, never zeros.

## 2. Layout — anchor + rotating stage

1920×1080 design canvas, all meaningful content inside a 5% safe inset. RTL structural: reading starts top-right.

- **Top band (~13%):** right → department wordmark + operational summary ("12/12 זמינים" as a semantic phrase, not bare zeros); left → clock (48–64 px, no seconds) + freshness chip ("עודכן לפני 40 שנ׳" + heartbeat dot). Optional quiet approvals utility chip lives here if kept at all.
- **State strip (full width, under the top band):** background tint encodes global state at ~15% opacity over base (desaturated green / amber / red) — the corridor-glance signal.
- **Main stage (~60%):** rotates between two views in Phase 1 — **Equipment view** (all-clear evidence composition or alert exception cards) and **Ops view** (waitlist/staging detail when non-zero, recent activity line). 300 ms cross-fade every ~45 s; rotation pauses in `alert` and during takeover states. Exception cards: name 40 px / location 32 px / elapsed-downtime timer 64 px; sorted by severity then elapsed time; more than three → "+N תקלות נוספות".
- **Bottom band (~25%, fixed):** three equal cards — אחראים (§4), חשמל, עמדות עגינה. Semantic phrasing ("2 מחוברות · 0 התראות" in neutral, red only when alerts > 0).
- Zero-value counters (רשימת המתנה / היערכות) never render as full-width empty bars — they collapse into compact top-band chips and expand into the stage only when non-zero.

## 3. Visual system

- **Type (Heebo, weights 500–700 only):** caption 28 px (absolute floor, nothing smaller anywhere) · body 32 · title 40 · headline 64 · display 120–160 for hero numbers. Hebrew gets headroom: when in doubt, one step up. Line-height ~1.15 display / 1.25–1.35 two-line labels. `font-variant-numeric: tabular-nums lining-nums` on every count and the clock; numbers cross-fade, never count-animate.
- **Palette (elevation ladder, no pure black):** base ≈ `#0F141A` → card ≈ `#161D26` → focal ≈ `#1C2530`; primary text off-white ≈ `#F2F5F8`, secondary ≈ `#A9B4C0`. Contrast target **7:1** for text (field margin for uncalibrated panels). No gradients/glass/glow; no hairline borders — grouping via surfaces, 16–24 px radii, generous padding; exception cards get a 6–8 px severity edge rail.
- **Status semantics:** red reserved exclusively for active problems (the current red "0 התראות חשמל" is corrected to neutral); every status = hue + icon shape + Hebrew word, never hue alone; success mint used sparingly (summary icon, not flooding).

## 4. Responsibles panel v2

Consumes the existing `responsibles` snapshot key (5 slots: ICU / admission / internal-medicine doctors, senior technician, equipment coordinator).

- ≥1 signed in: named slots at 32 px, role label + name, senior badge where applicable; empty slots grouped into one muted line.
- All empty: single aggregate row "0/5 סומנו למשמרת" + segmented 5-part progress bar filling **LTR** (Hebrew exception), plus the role names at caption size.
- Copy names the shift ("אף אחראי לא סומן למשמרת הבוקר") rather than bare "לא סומן" repetition.

## 5. RTL / bidi implementation rules

- `dir="rtl"` structural; CSS **logical properties only** (`margin-inline-*`, `inset-inline-*`, `text-align: start`).
- Bidi-isolate every mixed/numeric token: `12/12`, clock, equipment IDs, "בכיר ICU" — `<bdi>` or `dir="ltr"` spans.
- Never letter-space Hebrew; no italics; no synthetic bold.
- Do not mirror: checkmarks, clocks, power/plug icons, refresh. Progress bars fill LTR (Hebrew exception).

## 6. Data, freshness, kiosk

- **Zero server changes.** Same 5 s poll of `/api/display/snapshot` (frozen surface — untouched); all states derived client-side.
- **Connection state machine with hysteresis:** `live → delayed → stale → offline`; escalation requires multiple consecutive missed polls (thresholds: delayed ≈ 20 s, stale ≈ 2 min — constants, tuned later). Freshness chip escalates neutral → amber → the `stale` takeover. On recovery: "החיבור חודש" for ~5 s, one non-looping fade.
- Three timestamps distinguished in the client model: event time, last successful poll, render time — only the first two determine trust.
- **Kiosk:** ops runbook note (dedicated fullscreen browser profile, Vivid/sharpening/motion-smoothing off, brightness ≤60%); client-side night dimming outside clinic hours (clock-based, dim or clock-only mode); burn-in hygiene via night dim + stage rotation + slow 1–2 px layout drift.

## 7. Testing

- Unit: `resolveBoardState` — every transition incl. hysteresis, priority order, unconfigured-beats-all-clear, last-known-value retention.
- Component: one test per full-screen state + responsibles empty/mixed/full + freshness escalation.
- Visual regression: Playwright screenshots at 1920×1080 for the five states (extends the existing PW suite conventions; board tests live behind the `PW_SUITE` allowlist).
- Frozen-surface guard: no changes to snapshot route, SSE, or cache denylist — asserted by review, not new code.

## Out of scope (Phase 2+)

- Shifts now/next view; equipment location/custody view; any snapshot extension.
- Physical TV procurement/mounting; native TV app (react-native-tv) — the board remains a web kiosk.
- Any interactivity on the TV. Configuration, approvals, sign-ins stay on the console/mobile.
