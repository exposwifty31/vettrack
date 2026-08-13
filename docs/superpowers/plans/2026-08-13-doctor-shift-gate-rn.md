# Doctor Shift Gate — RN Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution cwd:** `/Users/dan/VetTrack-RN-Migration` (separate public repo). This plan file lives in vettrack (single planning source); the PR opens on the RN repo.
>
> **RN skills mandate applies** (`~/.claude/rules/rn-migration-skills-mandate.md`): load `react-native-best-practices`, `react-native-architecture`, `react-native-design`, `expo-native-ui`, `expo-data-fetching`, `react-navigation` BEFORE writing files; the PR body carries a Skills-compliance section. NOTE: the app uses React Navigation, NOT expo-router — the `expo-router` skill is a reasoned no-load.

**Goal:** The doctor shift gate (popup: "are you on shift?" → team picker ICU/קבלה/פנימית → optional senior toggle) in the RN app, POSTing to the same server endpoints the vettrack PR ships, plus a vet on-shift status card with end/switch actions.

**Architecture:** State-driven `<Modal>` + `BottomSheet` overlay (the `ShiftAdjustmentSheet` pattern) mounted in `MainTabs.tsx`, gated by `useIdentity().data.effectiveRole === "vet"`, an `["clinical-check-in","active"]` query, and an MMKV 8 h snooze via `safe-storage`. New per-domain API module on the `coded-error` `requestJson` helper.

**Tech Stack:** Expo SDK 57 / RN 0.86, React Navigation, TanStack Query, Uniwind (existing tokens ONLY — no styling infra changes; NativeWind is a known dead-end, do not revisit), i18next (he default, parity-tested), MMKV via `safe-storage`, jest-expo + @testing-library/react-native.

## Global Constraints

- Server contract (from the vettrack PR, must be merged/deployed first): `POST /api/clinical-check-in/check-in` body `{ operationalRole: "icu"|"admission"|"internal_medicine"; isSenior?: boolean; replaceSenior?: boolean }`; `POST /api/clinical-check-in/switch` same body; `POST /api/clinical-check-in/check-out`; `GET /api/clinical-check-in/me/active` → `{ active: CheckInRow | null }`. Error codes: `SENIOR_NOT_ELIGIBLE` (403), `SENIOR_REQUIRES_TEAM_ROLE` (422), `SENIOR_ALREADY_ASSIGNED` (409, metadata `currentSeniorName`), `ALREADY_CHECKED_IN` (409).
- Gate audience: `effectiveRole === "vet"` EXACTLY (admins are rejected server-side with `ROLE_NOT_ELIGIBLE_FOR_CHECK_IN`; technicians must not see it).
- The vendored `.vendor/vettrack/shared/doctor-operational-shift.ts` enum (`admission|ward|senior_lead|night_*`) is the LEGACY taxonomy — do not import it for the gate. The gate's team type is defined locally (`icu|admission|internal_medicine`) mirroring the server.
- Strings in BOTH `src/i18n/locales/en.json` + `he.json` (parity test fails otherwise). Hebrew is default.
- Snooze: MMKV key `vt.doctorGate.snoozeUntil` (epoch-ms as string), 8 h, via `safeStorageGetItem`/`safeStorageSetItem` wrapped in try/catch (they throw `StorageUnavailableError`).
- Component tests use the standard mock preamble: `jest.mock("@/components/PressableScale", …)` → plain `Pressable` (Reanimated can't init under jest).
- `npm run typecheck` + `npm run lint` + `npm test` clean before every commit.
- `seniorDoctorEligible` must be present on `GET /api/users/me` — verify against the deployed server before Task 4; if absent, fix the vettrack serializer first (it is a vettrack-side gap, not an RN workaround).

---

### Task 1: API module + types

**Files:**
- Create: `src/lib/api/clinical-check-in.ts`
- Modify: `src/types/api.ts` (add `seniorDoctorEligible?: boolean` to `MeUser`)
- Test: `src/lib/api/__tests__/clinical-check-in.test.ts`

**Interfaces (produces — consumed by Tasks 3–5):**

```ts
export type DoctorTeamRole = "icu" | "admission" | "internal_medicine";
export type CheckInRow = Readonly<{
  id: string; clinicId: string; userId: string;
  operationalRole: string | null; isSenior: boolean;
  clinicalRoleAtCheckIn: string; checkedInAt: string;
  checkedOutAt: string | null; checkOutReason: string | null;
}>;
export type OpenCheckInInput = Readonly<{
  operationalRole: DoctorTeamRole; isSenior?: boolean; replaceSenior?: boolean;
}>;
export const clinicalCheckInApi = {
  active: () => requestJson<{ active: CheckInRow | null }>("/api/clinical-check-in/me/active"),
  open: (input: OpenCheckInInput) => requestJson<CheckInRow>("/api/clinical-check-in/check-in", { method: "POST", body: JSON.stringify(input) }),
  switchRole: (input: OpenCheckInInput) => requestJson<CheckInRow>("/api/clinical-check-in/switch", { method: "POST", body: JSON.stringify(input) }),
  close: () => requestJson<CheckInRow>("/api/clinical-check-in/check-out", { method: "POST" }),
};
```

(`requestJson` + `ApiCodedError` from `./coded-error` — the canonical per-domain helper; same shape as `src/lib/api/shift-adjustments.ts`.)

- [ ] **Step 1: Failing test** — mock `authFetch`; assert paths/methods/bodies; non-OK response surfaces `ApiCodedError` with `.code` intact (e.g. `SENIOR_ALREADY_ASSIGNED`).
- [ ] **Step 2: Implement.** `npm test -- clinical-check-in` green; `npm run typecheck` clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(api): clinical check-in client module (doctor shift gate)"`

---

### Task 2: i18n — `doctorGate` keys (both locales)

**Files:**
- Modify: `src/i18n/locales/he.json`, `src/i18n/locales/en.json`

Keys (he shown; en mirrors, i18next `{{var}}` interpolation):

```json
"doctorGate": {
  "areYouOnShift": "האם אתה במשמרת?",
  "yes": "כן", "no": "לא",
  "pickTeam": "באיזה תפקיד?",
  "teamIcu": "ICU", "teamAdmission": "קבלה", "teamInternalMedicine": "פנימית",
  "iAmSenior": "אני הבכיר האחראי",
  "replaceSeniorTitle": "כבר יש בכיר",
  "replaceSeniorBody": "{{name}} כבר מסומן כבכיר {{team}} — להחליף אותו?",
  "replace": "החלף", "cancel": "ביטול",
  "onShiftStatus": "במשמרת — {{team}}", "onShiftSenior": "(בכיר)",
  "endShift": "סיום משמרת", "switchRole": "שינוי תפקיד",
  "checkInFailed": "הסימון נכשל — נסה שוב"
}
```

- [ ] **Step 1:** Add to both files → run `npm test -- parity` → green.
- [ ] **Step 2: Commit** — `git commit -m "feat(i18n): doctorGate strings (he/en)"`

---

### Task 3: Pure gate-state derivation + snooze helpers

**Files:**
- Create: `src/components/doctor-gate/doctor-gate-derive.ts`
- Test: `src/components/doctor-gate/__tests__/doctor-gate-derive.test.ts` (mirror `src/app/__tests__/bootstrap-view.test.ts` style)

**Interfaces (produces):**

```ts
export const DOCTOR_GATE_SNOOZE_KEY = "vt.doctorGate.snoozeUntil";
export const DOCTOR_GATE_SNOOZE_MS = 8 * 3_600_000;

export type DoctorGateView = "hidden" | "ask";
export function resolveDoctorGateView(args: Readonly<{
  effectiveRole: string | undefined;
  activeLoaded: boolean;               // the active-check-in query settled
  hasActiveCheckIn: boolean;
  snoozeUntilMs: number | null;
  nowMs: number;
}>): DoctorGateView;                    // "ask" ⇔ role==="vet" && activeLoaded && !hasActiveCheckIn && (snooze null or expired)

export function readGateSnooze(): number | null;      // safeStorageGetItem + parseInt, try/catch → null
export function writeGateSnooze(nowMs: number): void; // safeStorageSetItem(String(nowMs + DOCTOR_GATE_SNOOZE_MS)), try/catch best-effort
```

- [ ] **Step 1: Failing tests** — technician→hidden; admin→hidden; vet+active→hidden; vet+unsettled query→hidden; vet+expired snooze→ask; vet+live snooze→hidden; malformed stored value→treated as null.
- [ ] **Step 2: Implement.** Green. **Step 3: Commit** — `git commit -m "feat(gate): pure gate-state derivation + MMKV snooze"`

---

### Task 4: `DoctorShiftGate` component

**Files:**
- Create: `src/components/doctor-gate/DoctorShiftGate.tsx`
- Test: `src/components/doctor-gate/__tests__/DoctorShiftGate.test.tsx`

**Interfaces:**
- Consumes: Task 1 API + types, Task 2 keys, Task 3 derive/snooze, `useIdentity()` (`@/app/useIdentity`), `BottomSheet` (`@/components/ui/BottomSheet`), `PressableScale`, the `KindSegment` picker shape (`ShiftAdjustmentSheet.tsx:71-105`) and the `EmergencyToggle` switch shape (`DispenseSheet.tsx:113-140`) as styling precedents.
- Produces: `export function DoctorShiftGate(): ReactElement | null` — fully self-contained (queries + state inside).

Behavior contract:
- `useQuery({ queryKey: ["clinical-check-in","active"], queryFn: clinicalCheckInApi.active, enabled: identity.data?.effectiveRole === "vet" })`.
- `resolveDoctorGateView(...) === "ask"` → render `<Modal transparent statusBarTranslucent visible>` hosting `BottomSheet`:
  - Step "ask": title `t("doctorGate.areYouOnShift")`, two chips (`PressableScale`, `min-h-11`): כן / לא. לא → `writeGateSnooze(Date.now())` + local dismiss. כן → step "pick".
  - Step "pick": senior toggle FIRST (rendered only when `identity.data?.seniorDoctorEligible === true`; `accessibilityRole="switch"`), then three team buttons; a team tap fires the mutation immediately (`open({ operationalRole, isSenior })`) — no extra confirm.
  - Mutation error `SENIOR_ALREADY_ASSIGNED` → inline confirm block (`replaceSeniorBody` with `{{name}}` from the error payload, `{{team}}` from the tapped team): החלף → retry `{ replaceSenior: true }`; ביטול → back to "pick".
  - Other errors → `text-danger` note `t("doctorGate.checkInFailed")`, sheet stays.
  - Success → `queryClient.invalidateQueries({ queryKey: ["clinical-check-in","active"] })` + dismiss.
- Uniwind tokens only (`bg-glass-strong`, `text-foreground`, `text-muted`, `border-border`, selected-state style copied from `KindSegment`); Hebrew-first, RTL handled by the app-level `I18nManager` bootstrap (no per-component direction hacks).

- [ ] **Step 1: Failing tests** (standard preamble: mock `PressableScale`→`Pressable`; mock `@/app/useIdentity`; mock the API module):
  - technician identity → renders null;
  - vet, no active, no snooze → "ask" visible;
  - לא → snooze written + hidden;
  - כן → team tap posts `{operationalRole:"icu", isSenior:false}`;
  - toggle hidden when `seniorDoctorEligible` falsy; when true, toggle+team posts `isSenior:true`;
  - 409 `SENIOR_ALREADY_ASSIGNED` → replace-confirm shown; החלף retries with `replaceSenior:true`;
  - generic error → error note shown, sheet still mounted.
- [ ] **Step 2: Implement.** Green. **Step 3: Commit** — `git commit -m "feat(gate): DoctorShiftGate sheet (ask → team → senior/replace)"`

---

### Task 5: Mount in `MainTabs` + vet status card (end / switch)

**Files:**
- Modify: `src/navigation/MainTabs.tsx` (render `<DoctorShiftGate />` as a sibling of the tab navigator), `src/components/home/HomeScreen.tsx` (vet status card in `ListHeaderComponent`)
- Create: `src/components/doctor-gate/DoctorShiftStatusCard.tsx`
- Test: `src/components/doctor-gate/__tests__/DoctorShiftStatusCard.test.tsx`

**Interfaces:**
- `DoctorShiftStatusCard` — renders only for vets with an active check-in (same query key): `SectionCard` showing `t("doctorGate.onShiftStatus", { team })` + `(בכיר)` when `isSenior`, and two `PressableScale` actions: `endShift` → `clinicalCheckInApi.close()` → invalidate; `switchRole` → reopens the gate sheet in "pick" mode wired to `clinicalCheckInApi.switchRole`.

- [ ] **Step 1: Failing tests** — hidden for technician / no active; shows team label + senior suffix; end calls `close`; switch posts via `switchRole` (NOT close+open — atomicity is server-side).
- [ ] **Step 2: Implement + mount.** `MainTabs` renders the gate once, globally for the signed-in vet; HomeScreen header gains the card (FlashList `ListHeaderComponent` — keep it a plain View, no new blur layers; blur budget is GlassTopBar-only).
- [ ] **Step 3: Full suite `npm test` + typecheck + lint green. Commit** — `git commit -m "feat(gate): mount in MainTabs + vet on-shift status card"`

---

### Task 6: On-device verification + PR

- [ ] **Argent flow (skills: `argent-ios-simulator-setup` / `argent-android-emulator-setup` → `argent-device-interact` → `argent-test-ui-flow`):** sign in as the vet QA persona (`rn_tech_qa`-style Clerk vet user; server env must have `AUTHORITY_USE_CHECKIN_PATH=true` for downstream authority, though the gate itself only needs the endpoints) → gate appears → כן → קבלה → status card shows "במשמרת — קבלה" → verify the vettrack board snapshot now lists the doctor (curl `/api/display/snapshot` or open `/board`) → סיום משמרת → card gone, gate snoozed/not re-shown mid-session. Screenshot evidence for the PR.
- [ ] Proof-log entry (vettrack `docs/audit/PROOF_ALIGNMENT_LOG.md`) with the actual commands/outputs.
- [ ] PR on the RN repo: description includes server-contract dependency (vettrack PR must deploy first), **Skills-compliance section** (each loaded skill → what it changed or reasoned no-change, incl. `expo-router` no-load), and the device screenshots. Drive CodeRabbit to green; owner merges.
