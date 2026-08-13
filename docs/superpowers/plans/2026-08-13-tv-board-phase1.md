# TV Board Redesign Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/board` Command Center presentation layer as a state-driven, 10-foot-readable TV display — on existing snapshot data only, zero server changes.

**Architecture:** A pure client-side board state machine (`classifyBoardState` + `useBoardState` with exit-only hysteresis) replaces `useBoardMode` as the single layout driver, layered UNDER the frozen Code Blue early-return in `CommandBoardScreen`. The stage becomes state-dependent (takeovers / alert lock / rotating Equipment↔Ops views), fed by a new connection tracker derived from the existing TanStack query. Visual system: elevation-gray palette + 10-foot type scale via CSS tokens, composing with PR #178's `--tv-type-scale` mechanism.

**Tech Stack:** React 18 + Vite, TanStack Query, wouter, vitest + @testing-library/react, Playwright. Spec: `docs/superpowers/specs/2026-08-13-tv-board-redesign-phase1-design.md` — read it in full before starting.

## Global Constraints

- **Base branch:** `main` AFTER PR #178 merges (verify `src/features/command-board/use-board-tv-nav.ts` exists on your base; if not, STOP — #178 not merged yet). Work branch: `feat/tv-board-phase1`.
- **Zero server changes.** Nothing under `server/` may change. `/api/display/snapshot` route, its 5 s poll + 2 s Code Blue acceleration, SSE, and the SW cache denylist are frozen surfaces.
- **Code Blue is priority zero and frozen:** the early-return `if (snapshot.codeBlueSession) return <CodeBlueOverlay .../>` at `CommandBoardScreen.tsx:200-202` stays ABOVE all new state logic. No task may move or wrap it.
- **Absent ≠ zero (binding):** every optional snapshot block (`commandBoard`, `power`, `docks`, `waitlist`, `staging`, `responsibles`) renders a muted-unknown treatment when absent — never zeros (doctrine comment: `shared/equipment-board.ts:201-203`).
- **No Hebrew string literals in `.ts`/`.tsx`** (enforced by `tests/i18n-no-hebrew-in-source.test.ts`). New copy → `locales/he.json` + `locales/en.json` (parity enforced) + the hand-built `buildTranslations` in `src/lib/i18n.ts` (adding a JSON key alone is NOT enough for interpolated keys).
- **Type floors:** nothing below 28 px effective at 1080p; weights 500–700; `font-variant-numeric: tabular-nums lining-nums` on all counts/clock; numbers never count-animate; freshness in coarse buckets, downtime timers minute-granularity.
- **Owner decisions (locked):** approvals banner CUT entirely (incl. its poller); rotation locks on `alert`; single-view mode when Ops is empty; responsibles fill mapping per spec §4.
- **Every commit:** conventional message + trailer lines:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Fxi9HbrY7zaLkjCETTE4JX`
- **Gates before the final push:** `pnpm typecheck && pnpm test && pnpm i18n:check && pnpm architecture:gates`.
- Existing board tests pass `board`/`responsibles`/`currentShift` as PROPS (no `useDisplaySnapshot` mock) wrapped in wouter `<Router hook={memoryLocation().hook}>` — follow `tests/command-board-panels.test.tsx`'s `renderBoard` pattern.

---

### Task 1: `classifyBoardState` — the pure state classifier

**Files:**
- Create: `src/features/command-board/board-state.ts`
- Test: `tests/board-state-classify.test.ts`

**Interfaces:**
- Consumes: `DisplaySnapshot` (`src/types/safety-surfaces.ts:101-120`), `EquipmentCommandBoardSnapshot` (`shared/equipment-board.ts:171-215`).
- Produces (later tasks rely on these exact names):
  ```ts
  export type BoardStateKind = "stale" | "unconfigured" | "alert" | "attention" | "all_clear";
  export type ConnectionState = "live" | "delayed" | "stale" | "offline";
  export interface BoardStateInput { snapshot: DisplaySnapshot | undefined; connection: ConnectionState; }
  export function classifyBoardState(input: BoardStateInput): BoardStateKind;
  export function hasActiveAlert(board: EquipmentCommandBoardSnapshot | null | undefined): boolean;
  ```

- [ ] **Step 1: Write the failing test** — `tests/board-state-classify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyBoardState, hasActiveAlert } from "../src/features/command-board/board-state";
import type { DisplaySnapshot } from "../src/types/safety-surfaces";
import type { EquipmentCommandBoardSnapshot } from "../shared/equipment-board";

function makeBoard(over: Partial<EquipmentCommandBoardSnapshot> = {}): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-08-13T08:00:00Z", clinicId: "c1",
    overview: { total: 12, ready: 12, inUse: 0, issue: 0 },
    byType: [], byLocation: [], criticalUnits: [], alerts: [], roiSignals: [],
    ...over,
  } as EquipmentCommandBoardSnapshot;
}
function makeSnapshot(over: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    currentTime: "10:18", currentShift: [], hospitalizations: [], equipment: [],
    upcomingTasks: [], overdueTasks: [], activeAlertCount: 0, totalOverdueCount: 0,
    crashCartStatus: null, codeBlueSession: null,
    commandBoard: makeBoard(), responsibles: null,
    ...over,
  } as DisplaySnapshot;
}

describe("classifyBoardState priority order", () => {
  it("stale connection outranks everything (incl. unconfigured)", () => {
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: null }), connection: "stale" })).toBe("stale");
    expect(classifyBoardState({ snapshot: makeSnapshot(), connection: "offline" })).toBe("stale");
  });
  it("unconfigured when commandBoard absent or zero critical units configured", () => {
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: null }), connection: "live" })).toBe("unconfigured");
    const empty = makeBoard({ overview: { total: 0, ready: 0, inUse: 0, issue: 0 } });
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: empty }), connection: "live" })).toBe("unconfigured");
  });
  it("alert on any not-ready-not-in-use critical unit", () => {
    const b = makeBoard({ criticalUnits: [{ unitId: "u1", status: "maintenance" } as never] });
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: b }), connection: "live" })).toBe("alert");
  });
  it("alert on active power alerts, but NOT on power undefined", () => {
    const withAlerts = makeBoard({ power: { connected: 2, alerts: 1 } as never });
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: withAlerts }), connection: "live" })).toBe("alert");
    const noPower = makeBoard({ power: undefined });
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: noPower }), connection: "live" })).toBe("all_clear");
  });
  it("attention on non-zero waitlist/staging depth", () => {
    const b = makeBoard({ waitlist: { depth: 2 } as never });
    expect(classifyBoardState({ snapshot: makeSnapshot({ commandBoard: b }), connection: "live" })).toBe("attention");
  });
  it("attention on responsibles gaps only while currentShift is non-empty", () => {
    const gap = { doctors: { icu: { senior: null, members: [] }, admission: { senior: null, members: [] }, internal_medicine: { senior: null, members: [] } }, seniorTechnician: null, equipmentCoordinator: { name: null, status: "unresolved" } };
    const onShift = makeSnapshot({ responsibles: gap as never, currentShift: [{ employeeName: "Dana", role: "vet_tech" }] });
    expect(classifyBoardState({ snapshot: onShift, connection: "live" })).toBe("attention");
    const offShift = makeSnapshot({ responsibles: gap as never, currentShift: [] });
    expect(classifyBoardState({ snapshot: offShift, connection: "live" })).toBe("all_clear");
  });
  it("responsibles null (build failure) is NOT a gap signal", () => {
    const s = makeSnapshot({ responsibles: null, currentShift: [{ employeeName: "Dana", role: "vet_tech" }] });
    expect(classifyBoardState({ snapshot: s, connection: "live" })).toBe("all_clear");
  });
  it("all_clear otherwise; undefined snapshot with live connection is loading → treated stale-safe", () => {
    expect(classifyBoardState({ snapshot: makeSnapshot(), connection: "live" })).toBe("all_clear");
    expect(classifyBoardState({ snapshot: undefined, connection: "live" })).toBe("unconfigured");
  });
});

describe("hasActiveAlert", () => {
  it("true when any critical unit is neither ready nor in_use", () => {
    expect(hasActiveAlert(makeBoard({ criticalUnits: [{ unitId: "u", status: "ready" } as never] }))).toBe(false);
    expect(hasActiveAlert(makeBoard({ criticalUnits: [{ unitId: "u", status: "missing" } as never] }))).toBe(true);
  });
  it("false (not zero-alert) when board absent", () => {
    expect(hasActiveAlert(undefined)).toBe(false);
    expect(hasActiveAlert(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm test -- tests/board-state-classify.test.ts` → module not found.
- [ ] **Step 3: Implement** — `src/features/command-board/board-state.ts`:

```ts
import type { DisplaySnapshot } from "@/types/safety-surfaces";
import type { EquipmentCommandBoardSnapshot } from "../../../shared/equipment-board";

export type BoardStateKind = "stale" | "unconfigured" | "alert" | "attention" | "all_clear";
export type ConnectionState = "live" | "delayed" | "stale" | "offline";

export interface BoardStateInput {
  snapshot: DisplaySnapshot | undefined;
  connection: ConnectionState;
}

export function hasActiveAlert(board: EquipmentCommandBoardSnapshot | null | undefined): boolean {
  if (!board) return false;
  const unitDown = board.criticalUnits.some((u) => u.status !== "ready" && u.status !== "in_use");
  const powerAlerts = board.power ? board.power.alerts > 0 : false;
  return unitDown || powerAlerts;
}

function hasResponsiblesGap(snapshot: DisplaySnapshot): boolean {
  const r = snapshot.responsibles;
  // null/undefined = server-side build failure or pre-deploy server — unknown, NOT a gap.
  if (!r) return false;
  if (snapshot.currentShift.length === 0) return false; // shift data is the schedule source
  const doctorFilled = (b: { senior: unknown; members: unknown[] }) => b.senior != null || b.members.length > 0;
  const coordinatorFilled = r.equipmentCoordinator.status !== "unresolved";
  const filled =
    Number(doctorFilled(r.doctors.icu)) + Number(doctorFilled(r.doctors.admission)) +
    Number(doctorFilled(r.doctors.internal_medicine)) +
    Number(r.seniorTechnician != null) + Number(coordinatorFilled);
  return filled < 5;
}

export function classifyBoardState({ snapshot, connection }: BoardStateInput): BoardStateKind {
  if (connection === "stale" || connection === "offline") return "stale";
  const board = snapshot?.commandBoard;
  // Absent board or zero configured equipment = configuration hole, never good news.
  // unconfigured outranks alert safely: alert inputs derive from configured equipment.
  if (!board || board.overview.total === 0) return "unconfigured";
  if (hasActiveAlert(board)) return "alert";
  const waitDepth = board.waitlist?.depth ?? 0;
  const stagingDepth = board.staging?.depth ?? 0;
  if (waitDepth > 0 || stagingDepth > 0) return "attention";
  if (snapshot && hasResponsiblesGap(snapshot)) return "attention";
  return "all_clear";
}
```

Check the REAL field names before finishing: `board.waitlist` / `board.staging` depth fields and `power.alerts` — open `shared/equipment-board.ts` (blocks defined near L204-208) and match exactly; adjust the test fixtures to the true shapes (the `as never` casts above are placeholders for you to REPLACE with real typed fixtures).

- [ ] **Step 4: Run to verify PASS** — `pnpm test -- tests/board-state-classify.test.ts`.
- [ ] **Step 5: Commit** — `git add src/features/command-board/board-state.ts tests/board-state-classify.test.ts && git commit -m "feat(board): pure board state classifier with priority order + absent-vs-zero semantics"` (+ trailers).

---

### Task 2: `useBoardState` — exit-only hysteresis hook

**Files:**
- Create: `src/features/command-board/use-board-state.ts`
- Test: `tests/use-board-state.test.ts`

**Interfaces:**
- Consumes: `classifyBoardState`, `BoardStateKind`, `BoardStateInput` (Task 1).
- Produces: `export function useBoardState(input: BoardStateInput): BoardStateKind;` and `export const ALERT_EXIT_HOLD_MS = 30_000;`

Pattern to copy: `src/features/command-board/use-board-mode.ts:39-60` (exit-only hold — enter immediately, exit after continuous clear). Same structure, applied to `alert`: any raw state other than `alert` only takes effect after `ALERT_EXIT_HOLD_MS` of continuously-non-alert classification; entering `alert` is instant. All other state transitions are instant.

- [ ] **Step 1: Failing test** — `tests/use-board-state.test.ts` with `vi.useFakeTimers()` + `renderHook`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBoardState, ALERT_EXIT_HOLD_MS } from "../src/features/command-board/use-board-state";
// reuse makeSnapshot/makeBoard fixture helpers — copy them from tests/board-state-classify.test.ts (do NOT import across test files)

describe("useBoardState alert hysteresis", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("enters alert instantly, exits only after 30s continuous clear", () => {
    const alertInput = { snapshot: snapWithDownUnit(), connection: "live" as const };
    const clearInput = { snapshot: snapAllClear(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: alertInput });
    expect(result.current).toBe("alert");
    rerender(clearInput);
    expect(result.current).toBe("alert"); // still held
    act(() => vi.advanceTimersByTime(ALERT_EXIT_HOLD_MS - 1_000));
    rerender(clearInput);
    expect(result.current).toBe("alert");
    act(() => vi.advanceTimersByTime(2_000));
    rerender(clearInput);
    expect(result.current).toBe("all_clear");
  });

  it("flap suppression: re-alert during the hold window resets nothing visible", () => {
    const alertInput = { snapshot: snapWithDownUnit(), connection: "live" as const };
    const clearInput = { snapshot: snapAllClear(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: alertInput });
    rerender(clearInput);
    act(() => vi.advanceTimersByTime(15_000));
    rerender(alertInput); // flap back
    rerender(clearInput);
    act(() => vi.advanceTimersByTime(ALERT_EXIT_HOLD_MS - 5_000));
    rerender(clearInput);
    expect(result.current).toBe("alert"); // full hold restarted on the flap
  });

  it("takeovers are NOT held: stale wins instantly even from alert", () => {
    const alertInput = { snapshot: snapWithDownUnit(), connection: "live" as const };
    const { result, rerender } = renderHook((p) => useBoardState(p), { initialProps: alertInput });
    rerender({ snapshot: snapWithDownUnit(), connection: "stale" as const });
    expect(result.current).toBe("stale");
  });
});
```

- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** — mirror `use-board-mode.ts`'s `useEffect`+`useRef` clear-timestamp approach: track `lastAlertAt` ref; raw = `classifyBoardState(input)`; if raw === "alert" → return "alert" and stamp `lastAlertAt = Date.now()`; if previous returned state was "alert" and `Date.now() - lastAlertAt < ALERT_EXIT_HOLD_MS` and raw is `attention`/`all_clear` → keep "alert" (schedule a re-render timer for the remaining hold, cleared on unmount); `stale`/`unconfigured` bypass the hold entirely.
- [ ] **Step 4: Verify PASS** — `pnpm test -- tests/use-board-state.test.ts`.
- [ ] **Step 5: Commit** — `feat(board): useBoardState with exit-only alert hysteresis`.

---

### Task 3: Connection tracker

**Files:**
- Modify: `src/hooks/useDisplaySnapshot.ts` (23 lines — additive widening)
- Create: `src/hooks/use-display-connection.ts`
- Test: `tests/use-display-connection.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // useDisplaySnapshot.ts — ADD alongside the existing hook (existing signature unchanged):
  export function useDisplaySnapshotQuery(): UseQueryResult<DisplaySnapshot>;
  // use-display-connection.ts:
  export interface DisplayConnection { state: ConnectionState; lastSuccessAt: number | null; missedPolls: number; }
  export function useDisplayConnection(): DisplayConnection;
  export const DELAYED_AFTER_MISSED_POLLS = 4;
  export const STALE_AFTER_MISSED_POLLS = 24;   // ≈2 min at 5 s cadence — cadence-aware: counted in polls, not wall-time
  export const OFFLINE_AFTER_MISSED_POLLS = 60;
  ```

- [ ] **Step 1: Failing test** — drive with a mocked query result (mock `useDisplaySnapshotQuery` via `vi.mock("@/hooks/useDisplaySnapshot", ...)`): failureCount 0 → `live`; failureCount ≥ 4 → `delayed`; ≥ 24 → `stale`; ≥ 60 → `offline`; recovery (failureCount back to 0 with fresh `dataUpdatedAt`) → `live` immediately; hysteresis = escalation only by consecutive misses (TanStack's `failureCount` already resets on success — assert that behavior is what the derivation relies on).
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** — in `useDisplaySnapshot.ts`, extract the options object to a module-level `displaySnapshotQueryOptions` const; `useDisplaySnapshot()` keeps returning `.data` (callers unchanged); new `useDisplaySnapshotQuery()` returns the full `useQuery(displaySnapshotQueryOptions)` (same queryKey → shared cache, no extra request). `useDisplayConnection` derives from `failureCount` + `dataUpdatedAt`.
- [ ] **Step 4: Verify PASS + run the existing suite for the shared hook** — `pnpm test -- tests/use-display-connection.test.ts tests/display-snapshot-retry-and-timer.test.ts`.
- [ ] **Step 5: Commit** — `feat(board): display connection tracker derived from the snapshot query (additive)`.

---

### Task 4: i18n keys for all new copy

**Files:**
- Modify: `locales/he.json` (board namespace starts L3946), `locales/en.json` (mirror), `src/lib/i18n.ts` (`board` block in `buildTranslations` at ~L1210-1213)
- Test: existing `pnpm i18n:check` + `tests/i18n-parity.test.ts`

New keys under the existing `board` namespace (Hebrew first; English natural-equivalent, not literal):

```jsonc
// locales/he.json → "board": { ...existing keys...
"stateStale": "אין נתונים עדכניים",
"stateOffline": "אין חיבור לשרת",
"lastKnown": "מצב אחרון ידוע",
"lastGoodAt": "נתונים עד {{time}}",
"connectionRestored": "החיבור חודש",
"stateUnconfigured": "לא הוגדר ציוד קריטי",
"stateUnconfiguredHint": "יש להגדיר בקונסולת הניהול",
"freshnessNow": "עודכן כעת",
"freshnessUnderMinute": "לפני פחות מדקה",
"freshnessMinutes": "לפני {{count}} דק׳",
"allClearEvidence": "{{ready}} מתוך {{total}} · נבדק כעת",
"opsShiftTitle": "צוות במשמרת",
"opsEmptyWaitlist": "אין ציוד בהמתנה",
"opsEmptyStaging": "אין ציוד בהיערכות",
"responsiblesAggregate": "{{filled}}/5 סומנו למשמרת",
"responsiblesNoneShift": "אף אחראי לא סומן למשמרת",
"responsiblesNoSenior": "ללא בכיר",
"responsiblesDoctorCount": "{{count}} רופאים",
"responsiblesUnavailable": "נתוני אחראים אינם זמינים",
"blockUnavailable": "נתונים אינם זמינים",
"updatingNow": "מתעדכן…",
"alertOverflow": "+{{count}} תקלות נוספות",
"downFor": "{{minutes}} דק׳"
```

- [ ] **Step 1:** Add all keys to `locales/he.json` inside the existing `"board"` object (L3946+) and mirrored English to `locales/en.json` (e.g. `stateStale`: "Data is not current", `responsiblesAggregate`: "{{filled}}/5 signed in", `downFor`: "{{minutes}} min").
- [ ] **Step 2:** In `src/lib/i18n.ts` `buildTranslations` board block (~L1210, which already wraps `sincePrefix` with `tr(...)`), add function wrappers for every interpolated key, matching the existing style:

```ts
board: {
  ...d.board,
  sincePrefix: (time: string) => tr(d.board.sincePrefix, { time }),
  lastGoodAt: (time: string) => tr(d.board.lastGoodAt, { time }),
  freshnessMinutes: (count: number) => tr(d.board.freshnessMinutes, { count }),
  allClearEvidence: (ready: number, total: number) => tr(d.board.allClearEvidence, { ready, total }),
  responsiblesAggregate: (filled: number) => tr(d.board.responsiblesAggregate, { filled }),
  responsiblesDoctorCount: (count: number) => tr(d.board.responsiblesDoctorCount, { count }),
  alertOverflow: (count: number) => tr(d.board.alertOverflow, { count }),
  downFor: (minutes: number) => tr(d.board.downFor, { minutes }),
},
```

- [ ] **Step 3:** Regenerate types if the repo does so (`pnpm exec tsx scripts/i18n/generate-types.ts` — check `package.json` for the exact script name first) and run `pnpm i18n:check` → parity green; `pnpm test -- tests/i18n-parity.test.ts`.
- [ ] **Step 4: Commit** — `feat(board): i18n keys for board states, freshness, responsibles aggregate (he+en)`.

---

### Task 5: Visual tokens + status-semantics fix

**Files:**
- Modify: `src/index.css` (board tokens; TV styles live at L1149-1214 — compose, don't collide), `src/features/command-board/components/board-panels.tsx` (`PowerPanel` L48)
- Test: `tests/board-power-semantics.test.tsx` (new)

- [ ] **Step 1: Failing test** — `PowerPanel` with `{ connected: 2, alerts: 0 }` renders the alerts figure WITHOUT the danger/red class (assert via `data-testid="board-power-alerts"` you'll add + `className` not containing the red token / or a `data-severity="none"` attribute); with `alerts: 2` renders `data-severity="active"` + the alert icon glyph present. Follow the file's real class vocabulary — read `PowerPanel` first.
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement:**
  - `index.css`: add a `[data-board-shell]` scope block: elevation ladder custom properties `--board-bg: #0F141A; --board-card: #161D26; --board-focal: #1C2530; --board-text: #F2F5F8; --board-text2: #A9B4C0;` + `.board-nums { font-variant-numeric: tabular-nums lining-nums; }` + state-strip tint variables `--state-tint-ok / --state-tint-warn / --state-tint-alert` (desaturated, applied at 15% via `color-mix`). Do NOT touch the `--text-*-raw` tokens or `--tv-type-scale` mechanism from PR #178 (locked by `tests/stage-1-token-values.test.js`).
  - `PowerPanel`: alerts figure gets `data-severity={alerts > 0 ? "active" : "none"}`; red styling applied only for `"active"`; zero renders neutral (`--board-text2`) with the word, no red.
- [ ] **Step 4: Verify PASS** — new test + `pnpm test -- tests/command-board-panels.test.tsx tests/stage-1-token-values.test.js`.
- [ ] **Step 5: Commit** — `feat(board): elevation palette tokens + semantic power-alert color (red only when active)`.

---

### Task 6: Muted-unknown treatment for absent blocks

**Files:**
- Modify: `src/features/command-board/components/board-panels.tsx`
- Test: extend `tests/command-board-panels.test.tsx`

**Interfaces:**
- Produces: `export function UnknownBlock({ title }: { title: string }): JSX.Element;` in board-panels.tsx — muted panel showing `title` + `t.board.blockUnavailable`, `data-testid="board-block-unknown"`.

- [ ] **Step 1: Failing tests:** render `CommandBoard` with `board.power === undefined` → the power card shows `t.board.blockUnavailable` (and does NOT contain a "0"); same for `docks` undefined; `responsibles={null}` → responsibles card shows `t.board.responsiblesUnavailable`, NOT the 0/5 aggregate (aggregate itself lands in Task 7 — here assert only the unavailable copy for null).
- [ ] **Step 2: Verify FAIL** (today absent blocks render nothing or zeros — read the current call sites in `CommandBoard.tsx` calm mode L602-716 to see which).
- [ ] **Step 3: Implement:** `UnknownBlock` component; call sites in `CommandBoard` render `power ? <PowerPanel power={power}/> : <UnknownBlock title={t.board.powerTitle}/>` (use the REAL existing title keys — read them in board-panels.tsx); `ResponsiblesPanel` null-branch renders the unavailable copy instead of five `NotMarked` rows.
- [ ] **Step 4: Verify PASS.**
- [ ] **Step 5: Commit** — `feat(board): absent snapshot blocks render muted unknown, never zeros`.

---

### Task 7: Responsibles v2 — fill mapping + aggregate

**Files:**
- Create: `src/features/command-board/responsibles-fill.ts`
- Modify: `src/features/command-board/components/board-panels.tsx` (`ResponsiblesPanel` L159-192 + helpers)
- Test: `tests/board-responsibles-fill.test.ts` (pure) + extend `tests/board-responsibles-panel.test.tsx`

**Interfaces:**
- Consumes: `BoardResponsibles`, `DoctorTeamBlock`, `BoardCoordinatorStatus` (`src/types/safety-surfaces.ts:73-99`).
- Produces:
  ```ts
  export type SlotFill = "filled" | "filled_flagged" | "empty";
  export function doctorSlotFill(block: DoctorTeamBlock | undefined): SlotFill;      // senior→filled; members-only→filled_flagged; neither→empty
  export function coordinatorSlotFill(status: BoardCoordinatorStatus): SlotFill;     // auto|confirmed→filled; fallback_senior|needs_confirmation→filled_flagged; unresolved→empty
  export function countFilledSlots(r: BoardResponsibles): number;                    // 0..5, filled_flagged counts as filled
  ```

- [ ] **Step 1: Failing pure tests** — full matrix: doctor `{senior: {...}}` → filled; `{senior: null, members: [a]}` → filled_flagged; empty → empty; each coordinator enum value; `countFilledSlots` sums (flagged counts).
- [ ] **Step 2: Verify FAIL; implement `responsibles-fill.ts`; verify PASS.**
- [ ] **Step 3: Failing component tests** on `ResponsiblesPanel`:
  - all five empty → single aggregate row with `t.board.responsiblesAggregate` (filled=0) + a segmented progress element `data-testid="board-responsibles-progress"` with explicit `dir="ltr"` (Hebrew LTR-fill exception) + 5 segments; the five `NotMarked` rows are GONE.
  - mixed (icu has senior, rest empty) → icu named slot rendered + empties grouped into ONE muted line (not four).
  - doctor with members-but-no-senior → member-count via `t.board.responsiblesDoctorCount` + amber `t.board.responsiblesNoSenior` accent (`data-fill="filled_flagged"`).
  - coordinator `needs_confirmation` → name + `data-fill="filled_flagged"`.
  - keep the existing 8 green tests green (names always shown when filled — same testids `board-responsibles-*`).
- [ ] **Step 4: Implement panel changes; verify PASS** — `pnpm test -- tests/board-responsibles-fill.test.ts tests/board-responsibles-panel.test.tsx`.
- [ ] **Step 5: Commit** — `feat(board): responsibles fill mapping + 0/5 aggregate with LTR segmented progress`.

---

### Task 8: Top band, state strip, freshness chip + heartbeat

**Files:**
- Create: `src/features/command-board/components/board-status-band.tsx`
- Test: `tests/board-status-band.test.tsx`

**Interfaces:**
- Consumes: `BoardStateKind` (Task 1), `DisplayConnection` (Task 3), `t.board.*` (Task 4).
- Produces:
  ```tsx
  export function BoardTopBand(props: { departmentLabel: string; readyCount: number | null; totalCount: number | null; currentTime: string; connection: DisplayConnection }): JSX.Element;
  export function BoardStateStrip(props: { state: BoardStateKind }): JSX.Element;   // data-state attr drives the tint
  export function FreshnessChip(props: { connection: DisplayConnection; nowMs: number }): JSX.Element;
  export function formatFreshness(lastSuccessAt: number | null, nowMs: number): { key: "now" | "underMinute" | "minutes"; minutes?: number };
  ```

- [ ] **Step 1: Failing tests:** `formatFreshness` buckets (<10 s → now; <60 s → underMinute; else minutes, floor); `FreshnessChip` renders bucket copy + heartbeat dot `data-testid="board-heartbeat"` that re-keys on `lastSuccessAt` change (assert the element's `key`-driven remount via a `data-beat={lastSuccessAt}` attribute); chip carries `data-connection={connection.state}` for amber styling; `BoardStateStrip` sets `data-state="alert"` etc.; clock renders via existing `currentTime` (no seconds) inside a `<bdi dir="ltr">`; the ready/total summary renders `<bdi dir="ltr">12/12</bdi>` and when counts are null (board absent) renders `t.board.blockUnavailable` instead of "0/0".
- [ ] **Step 2: Verify FAIL → implement → PASS.** Styling: strip uses `background: color-mix(in oklab, var(--state-tint-*) 15%, var(--board-bg))` per `data-state`; heartbeat = 300 ms one-shot opacity pulse via CSS animation triggered by remount, `animation: none` under `prefers-reduced-motion`.
- [ ] **Step 3: Commit** — `feat(board): top band, tinted state strip, freshness chip with heartbeat`.

---

### Task 9: Takeover screens (stale/offline, unconfigured)

**Files:**
- Create: `src/features/command-board/components/board-takeovers.tsx`
- Test: `tests/board-takeovers.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export function StaleTakeover(props: { connection: DisplayConnection; lastSnapshot: DisplaySnapshot | undefined }): JSX.Element;
  export function UnconfiguredTakeover(): JSX.Element;
  ```

- [ ] **Step 1: Failing tests:** `StaleTakeover` with `connection.state === "stale"` shows `t.board.stateStale`; with `"offline"` shows `t.board.stateOffline`; shows `t.board.lastGoodAt(time)` from `lastSuccessAt` and — when `lastSnapshot` has a board — the last-known overview values wrapped under a `t.board.lastKnown` label (assert the label + that overview numbers still render; never zeroed). `UnconfiguredTakeover` shows `t.board.stateUnconfigured` + `t.board.stateUnconfiguredHint` and contains NO checkmark glyph and none of the success copy.
- [ ] **Step 2: FAIL → implement → PASS.** Both are full-stage compositions (amber accent, headline 64 px scale classes, icon+word).
- [ ] **Step 3: Commit** — `feat(board): stale/offline and unconfigured full-stage takeovers with last-known-state labeling`.

---

### Task 10: State-driven stage — all-clear evidence + alert lock (replaces useBoardMode)

**Files:**
- Modify: `src/features/command-board/components/CommandBoard.tsx` (mode branches L594-716; header shift block L540-549 moves in Task 11)
- Create: `src/features/command-board/components/board-stage-equipment.tsx`
- Delete usage (keep file until Task 14 cleanup): `useBoardMode` import at `CommandBoard.tsx:486`
- Test: `tests/board-stage-states.test.tsx` + update `tests/command-board-panels.test.tsx` pressure-threshold tests

**Interfaces:**
- Consumes: `useBoardState` (Task 2), `useDisplayConnection` (Task 3), takeovers (Task 9), band components (Task 8).
- Produces: `export function EquipmentStage(props: { board: EquipmentCommandBoardSnapshot; state: BoardStateKind; tvMode?: boolean; responsibles?: BoardResponsibles | null }): JSX.Element;`

- [ ] **Step 1: Failing tests** (render `CommandBoard` with props per state):
  - all_clear: stage shows check emblem `data-testid="board-allclear"` + `t.board.allClearEvidence(ready,total)` + a row of monitored-equipment tiles (one per `byType` entry with its count) — NOT a lone checkmark in a void.
  - alert: stage shows exception cards sorted severity→elapsed (fixture with 2 down units + timestamps), downtime via `t.board.downFor(minutes)` at minute granularity, severity edge rail `data-severity` attr; 5 down units → 3 cards + `t.board.alertOverflow(2)`.
  - the state strip + top band render in BOTH (anchor invariant).
  - `PressureMain`-era behavior: `activeEmergency != null` classifies as alert-stage content (linked-equipment cards preserved from the current `PressureMain` L366-438, including their `data-tv-focusable` metadata from PR #178).
  - ResponsiblesPanel still mounted in both states (bottom band — never unmounts).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement:** `CommandBoard` drops `useBoardMode`; consumes `state` as a new REQUIRED prop (`state: BoardStateKind`) so the component stays presentational/testable — `CommandBoardScreen` computes it (Task 12 wires). Render tree: top band → state strip → stage (switch on state: takeovers full-stage; alert → `EquipmentStage` locked; attention/all_clear → rotating stage placeholder that Task 11 fills — for THIS task render `EquipmentStage` directly) → bottom band (responsibles + power + docks). Port `PressureMain`'s linked-equipment + ticker content into the alert branch of `EquipmentStage`; delete the `mode === "calm"` / `mode === "pressure"` branches.
- [ ] **Step 4: PASS + full board suite** — `pnpm test -- tests/board-stage-states.test.tsx tests/command-board-panels.test.tsx tests/board-responsibles-panel.test.tsx tests/board-attention-render.test.tsx tests/board-tv-nav.test.tsx`. Update `tests/use-board-mode.test.ts` expectations → this file's subject is being replaced; REWRITE it to target `useBoardState` semantics or fold into Task 2's test and delete (state which you did in the commit message).
- [ ] **Step 5: Commit** — `feat(board): state-driven stage replaces calm/pressure — all-clear evidence + locked alert cards`.

---

### Task 11: Ops view + rotation engine + single-view mode

**Files:**
- Create: `src/features/command-board/use-stage-rotation.ts`, `src/features/command-board/components/board-stage-ops.tsx`
- Modify: `src/features/command-board/components/CommandBoard.tsx` (wire rotation; REMOVE the header currentShift block L540-549)
- Test: `tests/board-stage-rotation.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const STAGE_ROTATION_MS = 45_000;
  export type StageView = "equipment" | "ops";
  export function useStageRotation(opts: { state: BoardStateKind; opsHasContent: boolean }): StageView; // locks to "equipment" on alert/takeover or when !opsHasContent
  export function OpsStage(props: { board: EquipmentCommandBoardSnapshot; currentShift: Array<{ employeeName: string; role: string }> }): JSX.Element;
  export function opsHasContent(board: EquipmentCommandBoardSnapshot | null | undefined, currentShift: readonly unknown[]): boolean;
  ```

- [ ] **Step 1: Failing tests** (fake timers): rotation alternates equipment→ops→equipment at 45 s when `opsHasContent`; stays "equipment" forever when `!opsHasContent` (single-view mode); locks to "equipment" when state becomes "alert" mid-rotation and resumes after; `OpsStage` renders waitlist/staging detail when non-zero, `t.board.opsEmptyWaitlist`/`opsEmptyStaging` phrases when zero-but-other-content, and the relocated shift strip (`t.board.opsShiftTitle` + names/roles from `currentShift`); `opsHasContent` false only when waitlist 0 AND staging 0 AND currentShift empty; CommandBoard header no longer contains the shift names (moved).
- [ ] **Step 2: FAIL → implement → PASS.** Cross-fade: 300 ms opacity transition on view swap, `transition: none` under reduced-motion.
- [ ] **Step 3: Commit** — `feat(board): stage rotation with alert lock + single-view mode; shift strip relocated to Ops view`.

---

### Task 12: Wire the container + CUT the approvals poller

**Files:**
- Modify: `src/features/command-board/CommandBoardScreen.tsx` (query L76-81, `autopilotQueueCount` L81, prop pass L255; Code Blue return L200-202 UNTOUCHED), `src/features/command-board/components/CommandBoard.tsx` (drop `proposalCount` prop), `src/features/command-board/components/BoardAttentionSection.tsx` (remove proposal rendering, keep anomalies)
- Test: update `tests/board-attention-proposal-count.test.tsx` (repurpose: asserts the proposals query/banner is GONE), `tests/board-attention-render.test.tsx` (anomalies still render)

- [ ] **Step 1: Failing tests:** `BoardAttentionSection` renders anomalies without any proposal count; `CommandBoard` type no longer accepts `proposalCount` (typecheck-level); CommandBoardScreen no longer imports `proposalQueueQueryKey`/`api.actionProposals` (assert via the frozen-guard source test in Task 14 — here just do the code change + keep component tests green).
- [ ] **Step 2: Implement:** delete the `useQuery` block (L76-81), `autopilotQueueCount`, the prop, and the proposal branch in `BoardAttentionSection`; wire the new container flow:

```tsx
const query = useDisplaySnapshotQuery();
const snapshot = query.data;
const connection = useDisplayConnection();
// ... skeleton + codeBlueSession early-return + legacy !commandBoard fallback stay EXACTLY as-is (L165-242) ...
const state = useBoardState({ snapshot, connection });
<CommandBoard board={board} state={state} connection={connection} ... />
```

  Note: the legacy `!board` fallback (L204-242) is now reachable only when `state` is a takeover/unconfigured — CommandBoard's unconfigured takeover replaces it; delete the legacy fallback block and let the state machine own it (verify no other consumer).
- [ ] **Step 3: PASS** — full `pnpm test -- tests/` board files + `pnpm typecheck`.
- [ ] **Step 4: Commit** — `feat(board): wire state machine into container; cut approvals poller from the kiosk (owner decision)`.

---

### Task 13: Night dim + layout drift + kiosk runbook

**Files:**
- Create: `src/board/use-night-dim.ts`, `docs/runbooks/board-kiosk.md`
- Modify: `src/board/BoardShell.tsx` (mount the hook; apply `data-night-dim` + drift transform)
- Test: `tests/board-night-dim.test.ts`

**Interfaces:**
- Produces: `export function useNightDim(opts: { state: BoardStateKind | null; codeBlueActive: boolean; nowHours?: number }): boolean;` + `export const NIGHT_DIM_START_HOUR = 22; export const NIGHT_DIM_END_HOUR = 6;` (documented clock constants — no server schedule source in Phase 1).

- [ ] **Step 1: Failing tests:** dims at 23:00 with all_clear; does NOT dim at 23:00 with state "alert"; does NOT dim during Code Blue; no dim at 10:00.
- [ ] **Step 2: Implement:** hook returns boolean; `BoardShell` applies `data-night-dim` → CSS `filter: brightness(0.35)` + a 6-minute-interval 1–2 px `translate` drift cycle on the content wrapper (CSS keyframes, steps, no continuous motion; disabled under reduced-motion). BoardShell needs `state`/`codeBlueActive` — read the snapshot cache the same read-only way `useBoardAutoReload` does (useSyncExternalStore on the query cache) to avoid prop-drilling through the route boundary.
- [ ] **Step 3:** Write `docs/runbooks/board-kiosk.md`: dedicated fullscreen browser profile steps, TV calibration (disable Vivid/sharpening/motion-smoothing/dynamic-contrast, brightness ≤60%), **validate state-strip tint visibility from the corridor before locking the 15% opacity**, night-dim hours constant location, burn-in hygiene summary, and the corridor acceptance test (2–3 s glance answers "is anything wrong / waiting?").
- [ ] **Step 4: PASS → Commit** — `feat(board): night dim with alert/code-blue override + kiosk runbook`.

---

### Task 14: Frozen-surface guard test, Playwright visual states, final gates + PR

**Files:**
- Create: `tests/board-frozen-surface-guard.test.ts`, `tests/board-states.spec.ts`
- Modify: `playwright.shared.ts` (add `board-states.spec.ts` to `PLAYWRIGHT_SUITE_MATCH.board` L51 and `.ci` L43-48)
- Delete: `src/features/command-board/use-board-mode.ts` + `tests/use-board-mode.test.ts` if not already removed in Task 10 (run `grep -r "useBoardMode\|use-board-mode" src/ tests/` first — zero consumers required)
- Modify: `docs/audit/PROOF_ALIGNMENT_LOG.md` (append entry)

- [ ] **Step 1: Frozen-surface guard test** (adapts the spec's ESLint idea — the repo has NO lint infra, so the guard is a vitest source-scan, matching the repo's existing guard-test convention e.g. `tests/i18n-no-hebrew-in-source.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("board frozen surfaces", () => {
  it("CommandBoardScreen keeps the Code Blue early-return before any board-state logic", () => {
    const src = readFileSync("src/features/command-board/CommandBoardScreen.tsx", "utf8");
    const codeBlueIdx = src.indexOf("snapshot.codeBlueSession");
    const stateIdx = src.indexOf("useBoardState(");
    expect(codeBlueIdx).toBeGreaterThan(-1);
    expect(stateIdx).toBeGreaterThan(-1);
    expect(codeBlueIdx).toBeLessThan(stateIdx);
  });
  it("snapshot hook keeps the frozen poll contract (5s / 2s code-blue acceleration)", () => {
    const src = readFileSync("src/hooks/useDisplaySnapshot.ts", "utf8");
    expect(src).toContain("codeBlueSession ? 2_000 : 5_000");
    expect(src).toContain('"/api/display/snapshot"');
  });
  it("board modules do not import the approvals queue (cut by owner decision)", () => {
    const files = ["src/features/command-board/CommandBoardScreen.tsx", "src/features/command-board/components/CommandBoard.tsx", "src/features/command-board/components/BoardAttentionSection.tsx"];
    for (const f of files) expect(readFileSync(f, "utf8")).not.toContain("actionProposals");
  });
});
```

- [ ] **Step 2: Playwright visual states** — `tests/board-states.spec.ts`: viewport 1920×1080; `page.route("**/api/display/snapshot", ...)` fulfilling fixture JSON per state (all_clear / alert / attention / unconfigured; stale by aborting the route after first fulfill); navigate to `/board?tv=1`; `await expect(page.locator('[data-state="alert"]'))…` per state + `toHaveScreenshot("board-<state>.png", { maxDiffPixelRatio: 0.02 })`. Generate baselines with `--update-snapshots` and commit them. Run: `PW_SUITE=board pnpm exec playwright test` against the dev server (`pnpm dev:walk` per the flow-walk runbook — NOT plain `dev`).
- [ ] **Step 3: Full gates** — `pnpm typecheck && pnpm test && pnpm i18n:check && pnpm architecture:gates` all green; append proof-log entry with actual outputs.
- [ ] **Step 4: Commit + push + PR** — push `feat/tv-board-phase1`; `gh pr create` to main, titled `feat(board): TV board redesign phase 1 — state machine, 10-foot visual system, anchor+rotation stage`. PR body: repo template + link to the spec + council docs, the four owner decisions, Clinical-Safety note (Code Blue ordering guard test), and the standard footer.

---

## Self-review notes (done at authoring)

- Spec coverage: §1 state machine → Tasks 1-2; Code Blue priority zero → Global Constraints + Task 14 guard; connection/§6 → Task 3; absent≠zero → Tasks 1, 6, 8; §2 layout → Tasks 8-12; §3 visual → Tasks 4-5; §4 responsibles → Task 7; §5 RTL → Tasks 7-8 (bdi/LTR-progress) + existing structural RTL; night dim/kiosk/§6 → Task 13; §7 testing (incl. flap suppression, rotation lock, guard-as-code, PW screenshots) → Tasks 2, 11, 14.
- Spec deviation (documented): the §7 "ESLint no-restricted-imports" guard is implemented as a vitest source-scan guard test (Task 14) because the repo has no ESLint infrastructure at all — introducing lint tooling from scratch is out of Phase-1 scope. Same durability, zero new tooling.
- The `as never` fixture casts in Task 1's test listing are an explicit instruction to the implementer to replace with real typed fixtures after reading `shared/equipment-board.ts` — not shippable code.
