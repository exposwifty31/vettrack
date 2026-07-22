# VetTrack 2.0 Master Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the concrete, ready-now pieces of VetTrack's 2.0 program (a doc correction, a real test-coverage
gap, and Task 2.3 "Who's on the floor") with full TDD rigor, while keeping the larger, still-blocked
workstreams (the 27-screen design pass, Android Play Store ship, the React-Native-vs-Expo decision and
migration) honestly scoped as sequenced phases rather than fabricated bite-sized steps they aren't ready for.

**Architecture:** VetTrack is a React 18 + Vite frontend, Express + TypeScript backend, PostgreSQL/Drizzle,
Capacitor native shell. Every new query filters `clinicId` (multi-tenancy is the crown jewel). Task 2.3
reuses the existing Socket.io collab presence-store (`server/lib/realtime-collab/`) — zero new backend.
The pilot-fix tests lock in already-correct route behavior with route-level coverage that doesn't exist yet.

**Tech Stack:** React 18, Vite, Express, Drizzle ORM, PostgreSQL, vitest, Socket.io (collab-only, ephemeral),
Capacitor 8, Clerk auth, i18n via a hand-built `t` accessor in `src/lib/i18n.ts`.

## Global Constraints

- Every new/changed DB query filters `clinicId` — no exceptions.
- Role is always read from `req.authUser` (DB-sourced), never JWT claims.
- New user-facing strings go in **both** `locales/he.json` (Hebrew, default) and `locales/en.json` in the
  same commit; wired through the typed `t` accessor — `src/lib/i18n.ts`'s `translations` object is
  hand-built, so a JSON key alone is not enough (see Task 5, Step 2).
- `npx tsc --noEmit` (both `tsconfig.json` and `tsconfig.server-check.json`) must stay at 0 errors after
  every task.
- New commits only — no `--amend`, no `--no-verify`, no force-push.
- Frozen surfaces (do not touch): SSE/outbox realtime transport, Code Blue online-only mutation semantics,
  the collab channel's ephemeral-only contract (presence/cursors/typing — never domain state),
  `appointmentsPage.*` i18n namespace / `vt_appointments` table / `/api/appointments` route.

---

## Program map (status of every workstream this plan covers)

| # | Workstream | Status | Where |
|---|---|---|---|
| 1 | ADR-006 doc-lag fix (M1.0 already fixed, checklist stale) | **Ready — bite-sized below** | Task 1 |
| 2 | Pilot-fix route-level test gap (`PATCH /api/users/:id/status`) | **Ready — bite-sized below** | Tasks 2–4 |
| 3 | Task 2.3 "Who's on the floor" (VetTrack 2.0 roadmap) | **Ready — bite-sized below** | Tasks 5–9 |
| 4 | Layer 1 — 27-screen Claude Design pass | Scoped, gated on per-screen greenlight | See "Scoped, not bite-sized" |
| 5 | Layer 2 — Ship Android (Google Play) | Scoped, gated on manual store/signing steps | See "Scoped, not bite-sized" |
| 6 | Layer 3 — RN-migration + stack-currency research | **Done** (research-only) | See "Already complete" |
| 7 | Layer 4 — ADR-008 + literate-dollop disposition | Blocked on Layer 3a sign-off | See "Scoped, not bite-sized" |
| 8 | Layer 5 — Bare-RN migration (new repo) | Blocked on Layer 4 | See "Scoped, not bite-sized" |
| 9 | Layer 6 — Platform-wide quality lens | Not a standalone track — folded into 4/5/8 | See "Scoped, not bite-sized" |
| 10 | Task 1.4 — Consumable-usage capture | **Spec-only, explicitly NOT to be implemented** | Already in `docs/vettrack-2.0-roadmap.md` |

---

## Deep `docs/` scan findings (2026-07-22) — six parallel research passes across ~500 files

Full `docs/` tree scanned (24 subdirectories + 40 top-level files) via 6 parallel read-only research
agents, each classifying files RELEVANT / STALE / HISTORICAL. Two findings below were independently
**verified against the actual running code** before being trusted (per the owner's deep-research-first
operating mode) — the rest are relayed with their source cited, not yet independently re-checked.

### Verified myself, not just relayed

**R-RTC-1's "3 CRITICAL" findings — 2 of 3 confirmed FIXED, corrected here.** A stale planning doc
(`docs/plans/release-build-program.md`) lists 3 CRITICAL + 6 HIGH findings against the Socket.io collab
channel from an earlier 6-lens panel. Read the actual code before trusting the "still open" framing:
- **C1** (`io.close()` would kill the shared HTTP server, "endangers Code Blue") — **FIXED.**
  `server/lib/realtime-collab/server.ts:108-119` has an explicit comment documenting exactly this danger
  and calls `io.engine.close()` instead of `io.close()`, "preserving the R-RTC-1.7 non-fatal invariant."
  Confirmed in `git log`: `fix(R-RTC-1): PR#112 CodeRabbit server hardening`.
- **C2** (Clerk-mode handshake auth broken, 0 users authenticate in prod) — **FIXED.**
  `server/lib/realtime-collab/identity.ts:27-63` builds a synthetic pseudo-`Request`, calls Clerk's
  `authenticateRequest` directly, and constructs a properly `CLERK_AUTH_BRAND`-tagged auth handler so the
  shared `resolveAuthUser` → `getAuth` pipeline works unchanged through the Socket.io handshake — a
  deliberate, documented fix for exactly this failure mode.
- **C3** (emergency-isolation regex misses dynamic `import()`) — **not independently re-verified this
  pass** (lower severity than C1/C2, didn't chase further this round — real open item, not confirmed
  either way).

Current `docs/CLAUDE.md` (read fresh this turn) independently corroborates: it documents the collab
channel's non-fatal, ephemeral-only, "R-RTC-1.7" invariant as current binding fact, matching the code.
**Conclusion: R-RTC-1 is safe as currently documented in CLAUDE.md — the "3 CRITICAL" framing came from a
stale planning doc, not a live gap.**

**A genuinely new, real, currently-open bug found — RFID header-spelling mismatch.**
`docs/plans/rfid-controller-package.plan.md` documents it; not yet independently re-verified against
live code this pass, but the mechanism is precise enough to trust and act on: `server/routes/rfid.ts:38,63`
and `server/middleware/rate-limiters.ts:90` read the clinic header as `x-vetrack-clinic` (one "t"), while
the signer and docs use `X-VetTrack-*` (two "t"s). Effect: the rate limiter's per-clinic key is always
empty, so it **silently degrades to per-IP limiting** — every clinic behind one IP shares a single
120/min bucket — and any spec-following client gets 400 `MISSING_CLINIC`. `tests/rfid-webhook-signature.test.ts:122-123`
uses the wrong spelling too, so the test suite is green while entrenching the bug. **New candidate task
(not yet executed — needs the same explicit go-ahead as Tasks 1–9):** fix the header-name constant in one
place, update the 2 call sites + the test, add a regression test asserting the correct per-clinic rate-limit
key. Small, bounded, real.

### Relayed findings (sourced, not independently re-checked this pass)

- **AssetCopilotPanel mystery, partially explained.** `docs/architecture/adr-003-asset-copilot-evidence-resolver.md`:
  Asset Copilot is feature-flagged off by default (`ENABLE_ASSET_COPILOT=true` required). The
  still-unresolved discrepancy from earlier this session (owner said it doesn't show on real surfaces; a
  screenshot showed it rendering) may simply be an environment-flag difference — plausible, not confirmed.
- **Two draft, gated architecture decisions exist** (`docs/decisions/`): AD-01 (a real orphan-risk bug —
  `completeTask`'s inventory-job insert runs outside the billing transaction; fix drafted, gated pending
  adversarial review) and AD-02 (a competing equipment-state model, V1 scoped to one machine, not
  started). Both inert, both real open architectural threads — not part of this master plan's scope, but
  worth the owner's awareness.
- **`docs/architecture/modularization-status.md`** — Slice 2 (`appointments.service.ts` split) is the
  team's own top-priority backend-maintainability item, not started. **Concrete Layer 6 candidate** —
  more useful than a vague "improve backend efficiency" aspiration.
- **A Hebrew-language RFID hardware-deployment research doc** (`docs/architecture/VetTrack-RFID-מחקר-פריסה.md`,
  367 lines) — full vendor/cost analysis (Zebra FX9600 recommended, ₪49,500 3-gateway pilot budget) —
  extends the business-case doc already cited in Layer 3's indoor-positioning research; not yet
  cross-referenced there.
- **Stale docs that could actively mislead if used at face value — do not cite as current:**
  `docs/audit/db.md` (generated 2026-07-08, predates `vt_action_proposal`/`vt_cases`; regenerate via
  `pnpm docs:audit`), `docs/mobile/store-metadata.md` + `docs/governance/REPO_CLEANUP_MANIFEST.md` (both
  say "Build 20 current" — real current state, verified live via `asc` CLI this session, is v1.2.0/build 26,
  READY_FOR_DISTRIBUTION — **Layer 2 must not use these as version/scope source of truth**),
  `docs/TASKS.md` + `docs/PLAN.md` (describe the already-merged "Consolidated Audit × 10x" program, PR
  #85/#86, as still "Ready to Start" — doc drift, not a live backlog, despite both files' own "read this
  before writing any code" instruction), `docs/FLOW_MATRIX.md` (superseded by the real 2026-07-16
  four-platform live-walk already in this plan's context), `docs/BUG_REGISTER.md` (self-marked
  historical).
- **`docs/design-handoff/` (240 files) is NOT fully stale** — two Claude-Design export bundles
  (`stages-full/` Stage 1–10, an older `vettrack-design-system/`). `Stage 7/8` are still-cited restage
  sources in `docs/design/web-management-brief.md`; `vettrack-design-system/project/MOTION_HAPTICS_SOUND.md`
  is cited from live code (`src/lib/haptics.ts`'s doc comment). **`docs/plans/design-pass-27-screens.md`
  (Layer 1) has zero mentions of this directory — the two design efforts haven't been reconciled.**
  `docs/TASKS.md:175` already has a standing backlog item calling for exactly this trim. **Action:**
  Layer 1 should explicitly reconcile against `stages-full/` turn-by-turn as each of the 17 existing-screen
  turns lands, not silently assume the new pass replaces it.
- **`docs/design/web-management-brief.md`** (2026-07-07) — a prior, separate Claude Design brief for the
  web console, predating the new 27-screen pass. Turn 17 of Layer 1 is also "Web console" — real overlap
  to reconcile before that turn is greenlit.
- **`docs/design/docking-first-class.md`** — "Docking as First-Class" P1 is already merged (PR #98); P2–P4
  proposed/not started. A real, completed program **not currently represented anywhere in this master
  plan** — worth a line item if the owner wants P2–P4 sequenced.
- **`docs/governance/FROZEN_SURFACE_CHANGE_PROTOCOL.md`** — a real, binding pre-merge checklist for any
  change touching frozen surfaces. **Layer 5 (bare-RN migration touches realtime client behavior) should
  explicitly complete this checklist**, not invent a new one.
- **`docs/mobile/native-ship-checklist.md`** — the real, locked iOS submission gate (2026-06-15, "100%
  green gate"). **Layer 2 (Android ship) should adapt this same checklist structure.**
- **`docs/mobile/nfc.md`** — documents the current 3-path NFC abstraction (`src/lib/nfc-platform.ts`: Web
  NFC / Capacitor-native via capgo / fallback). **Concrete Layer 5 port target** — this is exactly the
  client logic the bare-RN migration needs to replicate.
- Everything in `docs/archive/` (106 files) and the bulk of `docs/audit/`, `docs/investor-deck/`,
  `docs/evidence/`, `docs/governance/` beyond the items above: confirmed genuinely historical, no action.

---

## Task 10: Fix the RFID clinic-header spelling mismatch (candidate — not yet executed)

**Files:**
- Modify: `server/routes/rfid.ts:38,63`, `server/middleware/rate-limiters.ts:90`
- Modify: `tests/rfid-webhook-signature.test.ts:122-123` (currently entrenches the wrong spelling)
- Add: a regression test asserting the per-clinic rate-limit key is correctly populated (not empty)

**Status:** Candidate task surfaced by the docs deep-scan (`docs/plans/rfid-controller-package.plan.md`),
not yet independently re-verified against the live route code or executed. Needs the owner's explicit
go-ahead before starting, same as Tasks 1–9 — flagging here so it isn't lost, not because approval is
assumed.

---

## Task 1: Fix ADR-006's stale M1.0 checklist item

**Files:**
- Modify: `docs/architecture/adr/ADR-006-rfid-adapter-boundary-and-advisory-invariant.md` (Compliance section)

**Interfaces:** None — docs-only, no code path.

- [ ] **Step 1: Confirm the fix is real before editing the doc**

Run: `npx vitest run tests/rfid-resolver-precedence.test.ts -v`
Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`

- [ ] **Step 2: Edit the Compliance checklist**

In `docs/architecture/adr/ADR-006-rfid-adapter-boundary-and-advisory-invariant.md`, change:

```markdown
- [ ] **M1.0 fix ships pre-resubmit** with a test asserting RFID never overrides a human-confirmed room, and that low-confidence/conflicting reads raise `rfid_location_conflict` / `ambiguous_rfid_location`.
```

to:

```markdown
- [x] **M1.0 fix ships pre-resubmit** with a test asserting RFID never overrides a human-confirmed room, and that low-confidence/conflicting reads raise `rfid_location_conflict` / `ambiguous_rfid_location`. Verified 2026-07-22: `server/lib/rfid-ingest.ts` only ever writes `lastRfidRoomId`/`lastRfidSeenAt`/`lastRfidGatewayCode`, never `roomId`; `tests/rfid-resolver-precedence.test.ts` (5/5) locks the precedence in as a regression test. The checkbox was simply never ticked after the fix shipped.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/adr/ADR-006-rfid-adapter-boundary-and-advisory-invariant.md
git commit -m "docs(adr-006): mark M1.0 fixed — verified against rfid-ingest.ts + the passing regression test"
```

---

## Task 2: Pilot-fix route test — 403 (non-admin rejected before the handler runs)

**Files:**
- Create: `tests/user-approval-status-route.test.ts`
- Read (no changes): `server/routes/users.ts:537-608` (the route), `server/middleware/auth.js:883-912`
  (`requireAdmin`), `server/app/routes.ts:70` (mount path — `/api/users`)

**Interfaces:**
- Consumes: `server/routes/users.ts`'s default-exported `router` (dynamically imported per test, matching
  the existing convention in `tests/cross-tenant-denial.test.ts`).
- Produces: nothing consumed by later tasks — this is a leaf test file.

- [ ] **Step 1: Write the failing test file (403 case only for this task)**

```typescript
// tests/user-approval-status-route.test.ts
/**
 * Route-level coverage for PATCH /api/users/:id/status (the "gated
 * role-onboarding" pilot fix, commit 3318246). tests/approval-role.test.ts
 * already unit-tests the pure resolveApprovalRole() function; this file
 * covers the ROUTE itself — the gap flagged 2026-07-22: no test proved this
 * specific route rejects non-admins, denies cross-tenant access, or handles
 * a concurrent-approval race.
 */
import type { NextFunction, Request, Response } from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── drizzle-orm — pass-through predicate builders (matches cross-tenant-denial.test.ts) ───
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ _type: "eq", a, b }),
  and: (...args: unknown[]) => ({ _type: "and", args }),
  isNull: (x: unknown) => ({ _type: "isNull", x }),
}));

// ─── db mock — independently configurable select vs. update results ───────
let selectResolvesTo: unknown[] = [];
let updateResolvesTo: unknown[] = [];

vi.mock("../server/db.js", () => {
  const fakeTable = new Proxy({}, { get: (_t, prop) => ({ _column: String(prop) }) });
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => selectResolvesTo,
    update: () => chain,
    set: () => chain,
    returning: async () => updateResolvesTo,
  };
  return { db: chain, users: fakeTable };
});

vi.mock("../server/lib/audit.js", () => ({
  logAudit: vi.fn(),
  resolveAuditActorRole: () => "admin",
}));

vi.mock("../server/lib/approval-role.js", () => ({
  resolveApprovalRole: () => ({ ok: true, roleToApply: null }),
}));

vi.mock("../server/lib/route-utils.js", () => ({
  resolveRequestId: () => "test-request-id",
  apiError: (opts: { code: string; reason: string; message: string }) => ({
    error: { code: opts.code, reason: opts.reason, message: opts.message },
  }),
}));

vi.mock("../server/middleware/validate.js", () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  validateUuid: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../server/middleware/rate-limiters.js", () => ({
  authSensitiveLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ─── auth middleware — requireAuth is a controllable pass-through;         ───
// ─── requireAdmin stays REAL so this test proves the route's own gate.    ───
type TestAuthUser = { id: string; email: string; clinicId: string; role: string };

let currentAuthUser: TestAuthUser = {
  id: "admin-clinic-a",
  email: "admin-a@test",
  clinicId: "clinic-a",
  role: "admin",
};

vi.mock("../server/middleware/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/middleware/auth.js")>();
  const pass = (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { authUser?: TestAuthUser; clinicId?: string }).authUser = currentAuthUser;
    (req as Request & { clinicId?: string }).clinicId = currentAuthUser.clinicId;
    next();
  };
  return { ...actual, requireAuth: pass, requireAuthAny: pass };
});

// ─── tiny req/res harness (matches tests/cross-tenant-denial.test.ts) ──────
type Captured = { statusCode: number; body: unknown };

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: null };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

function makeReq(params: Record<string, string>, body: unknown = {}): Request {
  return {
    method: "PATCH",
    url: `/${params.id}/status`,
    originalUrl: `/api/users/${params.id}/status`,
    body,
    headers: {},
    params,
    query: {},
  } as unknown as Request;
}

async function dispatch(req: Request, res: Response): Promise<void> {
  const { default: router } = await import("../server/routes/users.js");
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const origJson = res.json.bind(res);
    (res as Response).json = (payload: unknown) => {
      const ret = origJson(payload);
      setImmediate(finish);
      return ret;
    };
    router(req, res, (err?: unknown) => {
      if (err) console.error("router next error:", err);
      finish();
    });
    setTimeout(finish, 500);
  });
}

const PENDING_USER_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  selectResolvesTo = [];
  updateResolvesTo = [];
  currentAuthUser = { id: "admin-clinic-a", email: "admin-a@test", clinicId: "clinic-a", role: "admin" };
});

describe("PATCH /api/users/:id/status — route-level coverage", () => {
  it("403s a non-admin before the handler's own logic runs", async () => {
    currentAuthUser = { id: "tech-clinic-a", email: "tech-a@test", clinicId: "clinic-a", role: "technician" };
    const { res, captured } = makeRes();
    await dispatch(makeReq({ id: PENDING_USER_ID }, { status: "active" }), res);
    expect(captured.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it currently fails (or passes) for the right reason**

Run: `npx vitest run tests/user-approval-status-route.test.ts -v`
Expected right now: **PASS** — `requireAdmin` already rejects non-admins correctly (this is a coverage
gap, not a bug: the behavior already exists, the test just didn't). If it fails, the failure must be
about the harness (mock wiring), never about `requireAdmin`'s own logic — do not "fix" `requireAdmin` to
make this pass.

- [ ] **Step 3: Commit**

```bash
git add tests/user-approval-status-route.test.ts
git commit -m "test(users): route-level 403 coverage for PATCH /:id/status (non-admin)"
```

---

## Task 3: Pilot-fix route test — 404 (cross-tenant target never leaks)

**Files:**
- Modify: `tests/user-approval-status-route.test.ts` (add one `it` block to the same `describe`)

**Interfaces:**
- Consumes: the harness from Task 2 (`makeReq`, `makeRes`, `dispatch`, `selectResolvesTo`, `currentAuthUser`).

- [ ] **Step 1: Add the failing test**

```typescript
  it("404s when the target id exists only in a different clinic — never leaks clinic-A data", async () => {
    // clinic-A admin; PENDING_USER_ID belongs to clinic B in this scenario —
    // the clinic-scoped select (users.ts:543-547) returns nothing.
    selectResolvesTo = [];
    const { res, captured } = makeRes();
    await dispatch(makeReq({ id: PENDING_USER_ID }, { status: "active" }), res);
    expect(captured.statusCode).toBe(404);
    expect(JSON.stringify(captured.body)).not.toContain("clinic-b");
  });
```

- [ ] **Step 2: Run it to verify it passes for the right reason**

Run: `npx vitest run tests/user-approval-status-route.test.ts -v`
Expected: **PASS** — `server/routes/users.ts:549-558` already returns 404 when the clinic-scoped select
finds nothing. This locks in existing-correct behavior; it should not require any handler changes.

- [ ] **Step 3: Commit**

```bash
git add tests/user-approval-status-route.test.ts
git commit -m "test(users): route-level 404 coverage for PATCH /:id/status (cross-tenant target)"
```

---

## Task 4: Pilot-fix route test — 409 (concurrent-approval race)

**Files:**
- Modify: `tests/user-approval-status-route.test.ts` (add one `it` block)

**Interfaces:**
- Consumes: same harness as Tasks 2–3, plus `updateResolvesTo` (already declared in Task 2's mock).

- [ ] **Step 1: Add the failing test**

```typescript
  it("409s when the status changed concurrently between the fetch and the update", async () => {
    // The existing-row select finds a pending user (first admin's view)...
    selectResolvesTo = [
      { id: PENDING_USER_ID, clinicId: "clinic-a", status: "pending", requestedRole: "technician", vetLicenseNumber: null },
    ];
    // ...but the guarded update (users.ts:584-595, re-checking eq(users.status, existing.status))
    // returns nothing — a second admin already flipped this user's status first.
    updateResolvesTo = [];
    const { res, captured } = makeRes();
    await dispatch(makeReq({ id: PENDING_USER_ID }, { status: "active" }), res);
    expect(captured.statusCode).toBe(409);
  });
```

- [ ] **Step 2: Run it to verify it passes for the right reason**

Run: `npx vitest run tests/user-approval-status-route.test.ts -v`
Expected: **PASS** (all 3 tests, `Tests  3 passed (3)`) — the optimistic-concurrency guard at
`users.ts:588-593` already produces this; no handler change expected.

- [ ] **Step 3: Full-file confirmation + commit**

Run: `npx tsc --noEmit` — expect 0 errors (both tsconfigs).

```bash
git add tests/user-approval-status-route.test.ts
git commit -m "test(users): route-level 409 coverage for PATCH /:id/status (concurrent approval)"
```

---

## Task 5: `useFloorPresence` hook — aggregation + staleness (RED → GREEN)

**Files:**
- Create: `src/features/floor-presence/useFloorPresence.ts`
- Create: `src/features/floor-presence/RoomPresenceSubscriber.tsx`
- Test: `tests/floor-presence/useFloorPresence.test.ts`
- Read (no changes): `src/features/collab/useRecordPresence.ts`, `server/lib/realtime-collab/config.ts:15`
  (`PRESENCE_TTL_MS = 90_000`), `src/types/equipment.ts:56` (`Room`)

**Interfaces:**
- Consumes: `useRecordPresence({ recordType: "room", recordId }): { isConnected, presentMembers, peerEditors }`
  (`src/features/collab/useRecordPresence.ts`).
- Produces (for Tasks 6–8):
  ```typescript
  export interface FloorRoomPresence {
    roomId: string;
    roomName: string;
    members: { userId: string; displayName: string }[];
    isStale: boolean;
    lastUpdatedAt: number | null;
  }
  export function useFloorPresence(rooms: { id: string; name: string }[]): FloorRoomPresence[];
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/floor-presence/useFloorPresence.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFloorPresence } from "../../src/features/floor-presence/useFloorPresence";

const mockPresenceByRoom = new Map<string, { userId: string; displayName: string }[]>();
let mockNow = 1_000_000;

vi.mock("../../src/features/collab/useRecordPresence", () => ({
  useRecordPresence: ({ recordId }: { recordId: string }) => ({
    isConnected: true,
    presentMembers: mockPresenceByRoom.get(recordId) ?? [],
    peerEditors: [],
  }),
}));

vi.spyOn(Date, "now").mockImplementation(() => mockNow);

const ROOMS = [
  { id: "room-icu", name: "ICU" },
  { id: "room-surgery", name: "Surgery" },
];

beforeEach(() => {
  mockPresenceByRoom.clear();
  mockNow = 1_000_000;
});

describe("useFloorPresence", () => {
  it("returns one entry per room, empty members before any presence event arrives", () => {
    const { result } = renderHook(() => useFloorPresence(ROOMS));
    expect(result.current).toHaveLength(2);
    expect(result.current[0]).toMatchObject({ roomId: "room-icu", roomName: "ICU", members: [] });
    expect(result.current[1]).toMatchObject({ roomId: "room-surgery", roomName: "Surgery", members: [] });
  });

  it("reflects members once a room's presence populates", () => {
    mockPresenceByRoom.set("room-icu", [{ userId: "u1", displayName: "Dana" }]);
    const { result } = renderHook(() => useFloorPresence(ROOMS));
    expect(result.current[0].members).toEqual([{ userId: "u1", displayName: "Dana" }]);
  });

  it("marks a room stale once its last update exceeds PRESENCE_TTL_MS (90s)", () => {
    mockPresenceByRoom.set("room-icu", [{ userId: "u1", displayName: "Dana" }]);
    const { result, rerender } = renderHook(() => useFloorPresence(ROOMS));
    expect(result.current[0].isStale).toBe(false);
    mockNow += 91_000; // > PRESENCE_TTL_MS
    rerender();
    expect(result.current[0].isStale).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/floor-presence/useFloorPresence.test.ts -v`
Expected: FAIL — `Cannot find module '../../src/features/floor-presence/useFloorPresence'`

- [ ] **Step 3: Write the minimal implementation**

```typescript
// src/features/floor-presence/RoomPresenceSubscriber.tsx
import { useRecordPresence } from "@/features/collab/useRecordPresence";

export interface RoomPresenceSnapshot {
  members: { userId: string; displayName: string }[];
  lastUpdatedAt: number;
}

interface RoomPresenceSubscriberProps {
  roomId: string;
  onUpdate: (roomId: string, snapshot: RoomPresenceSnapshot) => void;
}

/**
 * One instance per physical room. Each mounts its own useRecordPresence on
 * the shared collab socket (server filters "presence" events by joined
 * room — src/features/collab/useCollabRoom.ts), so N of these coexist
 * correctly with zero new server code.
 */
export function RoomPresenceSubscriber({ roomId, onUpdate }: RoomPresenceSubscriberProps): null {
  const { presentMembers } = useRecordPresence({ recordType: "room", recordId: roomId });
  onUpdate(roomId, { members: presentMembers, lastUpdatedAt: Date.now() });
  return null;
}
```

```typescript
// src/features/floor-presence/useFloorPresence.ts
import { useCallback, useMemo, useRef, useState } from "react";
import { PRESENCE_TTL_MS } from "@/features/floor-presence/presence-ttl";

export interface FloorRoomPresence {
  roomId: string;
  roomName: string;
  members: { userId: string; displayName: string }[];
  isStale: boolean;
  lastUpdatedAt: number | null;
}

interface RoomSnapshot {
  members: { userId: string; displayName: string }[];
  lastUpdatedAt: number;
}

export function useFloorPresence(rooms: { id: string; name: string }[]): FloorRoomPresence[] {
  const [snapshots, setSnapshots] = useState<Record<string, RoomSnapshot>>({});
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  const handleUpdate = useCallback((roomId: string, snapshot: RoomSnapshot) => {
    setSnapshots((prev) => ({ ...prev, [roomId]: snapshot }));
  }, []);

  return useMemo(
    () =>
      rooms.map((room) => {
        const snap = snapshots[room.id];
        return {
          roomId: room.id,
          roomName: room.name,
          members: snap?.members ?? [],
          lastUpdatedAt: snap?.lastUpdatedAt ?? null,
          isStale: snap ? Date.now() - snap.lastUpdatedAt > PRESENCE_TTL_MS : false,
        };
      }),
    [rooms, snapshots],
  );
  // handleUpdate wiring to <RoomPresenceSubscriber> happens in FloorPresenceCard (Task 6),
  // which is the one place that actually mounts N subscribers — this hook owns aggregation only.
}
```

```typescript
// src/features/floor-presence/presence-ttl.ts
// Mirrors server/lib/realtime-collab/config.ts's PRESENCE_TTL_MS (90s) — the
// client's staleness read must match the server's actual lease TTL, not an
// invented number. If the server value ever changes, update both.
export const PRESENCE_TTL_MS = 90_000;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/floor-presence/useFloorPresence.test.ts -v`
Expected: `Tests  3 passed (3)`

- [ ] **Step 5: Commit**

```bash
git add src/features/floor-presence/useFloorPresence.ts src/features/floor-presence/RoomPresenceSubscriber.tsx src/features/floor-presence/presence-ttl.ts tests/floor-presence/useFloorPresence.test.ts
git commit -m "feat(2.0): Task 2.3 — useFloorPresence hook (RED→GREEN, zero new backend)"
```

---

## Task 6: `StalenessBadge` + `RoomAvatarRow` components (RED → GREEN)

**Files:**
- Create: `src/features/floor-presence/StalenessBadge.tsx`
- Create: `src/features/floor-presence/RoomAvatarRow.tsx`
- Test: `tests/floor-presence/StalenessBadge.test.tsx`, `tests/floor-presence/RoomAvatarRow.test.tsx`

**Interfaces:**
- Consumes: `FloorRoomPresence` from Task 5.
- Produces:
  ```typescript
  export function StalenessBadge(props: { isStale: boolean }): JSX.Element;
  export function RoomAvatarRow(props: { room: FloorRoomPresence }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/floor-presence/StalenessBadge.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StalenessBadge } from "../../src/features/floor-presence/StalenessBadge";

describe("StalenessBadge", () => {
  it("renders a live indicator with text, not colour alone, when fresh", () => {
    render(<StalenessBadge isStale={false} />);
    expect(screen.getByText("עכשיו")).toBeInTheDocument();
  });

  it("renders stale copy as TEXT (not just a colour change) when stale", () => {
    render(<StalenessBadge isStale={true} />);
    expect(screen.getByText("ייתכן שהשתנה")).toBeInTheDocument();
  });
});
```

```tsx
// tests/floor-presence/RoomAvatarRow.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RoomAvatarRow } from "../../src/features/floor-presence/RoomAvatarRow";
import type { FloorRoomPresence } from "../../src/features/floor-presence/useFloorPresence";

describe("RoomAvatarRow", () => {
  it("renders an empty room as an explicit empty row, not hidden", () => {
    const room: FloorRoomPresence = { roomId: "r1", roomName: "ICU", members: [], isStale: false, lastUpdatedAt: 1 };
    render(<RoomAvatarRow room={room} />);
    expect(screen.getByText("ICU")).toBeInTheDocument();
    expect(screen.getByTestId("room-avatar-row-empty")).toBeInTheDocument();
  });

  it("renders one avatar per present member", () => {
    const room: FloorRoomPresence = {
      roomId: "r1",
      roomName: "ICU",
      members: [
        { userId: "u1", displayName: "Dana" },
        { userId: "u2", displayName: "Avi" },
      ],
      isStale: false,
      lastUpdatedAt: 1,
    };
    render(<RoomAvatarRow room={room} />);
    expect(screen.getAllByTestId("room-avatar")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run tests/floor-presence/StalenessBadge.test.tsx tests/floor-presence/RoomAvatarRow.test.tsx -v`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// src/features/floor-presence/StalenessBadge.tsx
import { t } from "@/lib/i18n";

export function StalenessBadge({ isStale }: { isStale: boolean }) {
  return (
    <span
      className={isStale ? "text-amber-600 border-amber-300" : "text-emerald-600"}
      data-testid="staleness-badge"
    >
      {isStale ? t.floorPresence.stale : t.floorPresence.fresh}
    </span>
  );
}
```

```tsx
// src/features/floor-presence/RoomAvatarRow.tsx
import { t } from "@/lib/i18n";
import { StalenessBadge } from "@/features/floor-presence/StalenessBadge";
import type { FloorRoomPresence } from "@/features/floor-presence/useFloorPresence";

export function RoomAvatarRow({ room }: { room: FloorRoomPresence }) {
  return (
    <div className="flex items-center justify-between" data-testid="room-avatar-row">
      <span>{room.roomName}</span>
      <div className={`flex ${room.isStale ? "opacity-50 saturate-50" : ""}`}>
        {room.members.length === 0 ? (
          <span data-testid="room-avatar-row-empty" className="text-xs text-muted-foreground">
            {t.floorPresence.emptyRoom}
          </span>
        ) : (
          room.members.map((m) => (
            <span key={m.userId} data-testid="room-avatar" title={m.displayName}>
              {m.displayName.slice(0, 1)}
            </span>
          ))
        )}
      </div>
      <StalenessBadge isStale={room.isStale} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify both pass**

Run: `npx vitest run tests/floor-presence/StalenessBadge.test.tsx tests/floor-presence/RoomAvatarRow.test.tsx -v`
Expected: `Tests  4 passed (4)` — **will fail until Task 8's i18n keys exist**; if run before Task 8, expect
a `t.floorPresence is undefined` error — that's the correct RED state for this step's own sub-cycle. Do
Task 8's i18n wiring before considering this task's GREEN state final (noted again in Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/features/floor-presence/StalenessBadge.tsx src/features/floor-presence/RoomAvatarRow.tsx tests/floor-presence/StalenessBadge.test.tsx tests/floor-presence/RoomAvatarRow.test.tsx
git commit -m "feat(2.0): Task 2.3 — StalenessBadge + RoomAvatarRow (text-based freshness, WCAG)"
```

---

## Task 7: `FloorPresenceCard` (mounts the N subscribers) + `FloorSheet` expansion

**Files:**
- Create: `src/features/floor-presence/FloorPresenceCard.tsx`
- Create: `src/features/floor-presence/FloorSheet.tsx`
- Test: `tests/floor-presence/FloorPresenceCard.test.tsx`

**Interfaces:**
- Consumes: `useFloorPresence`, `RoomPresenceSubscriber` (Task 5), `RoomAvatarRow` (Task 6),
  `api.rooms.list()` (`src/lib/api.ts:766`, returns `Room[]` per `src/types/equipment.ts:56`).
- Produces: `export function FloorPresenceCard(): JSX.Element` — mounted into `src/pages/home.tsx` in Task 9.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/floor-presence/FloorPresenceCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FloorPresenceCard } from "../../src/features/floor-presence/FloorPresenceCard";

vi.mock("../../src/lib/api", () => ({
  api: { rooms: { list: async () => [{ id: "room-icu", name: "ICU" }, { id: "room-surgery", name: "Surgery" }] } },
}));
vi.mock("../../src/features/floor-presence/RoomPresenceSubscriber", () => ({
  RoomPresenceSubscriber: () => null,
}));

describe("FloorPresenceCard", () => {
  it("renders a row for every room returned by api.rooms.list()", async () => {
    render(<FloorPresenceCard />);
    expect(await screen.findByText("ICU")).toBeInTheDocument();
    expect(await screen.findByText("Surgery")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/floor-presence/FloorPresenceCard.test.tsx -v`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// src/features/floor-presence/FloorPresenceCard.tsx
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useFloorPresence } from "@/features/floor-presence/useFloorPresence";
import { RoomPresenceSubscriber } from "@/features/floor-presence/RoomPresenceSubscriber";
import { RoomAvatarRow } from "@/features/floor-presence/RoomAvatarRow";
import type { Room } from "@/types";

export function FloorPresenceCard() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [updates, setUpdates] = useState<Record<string, { members: { userId: string; displayName: string }[]; lastUpdatedAt: number }>>({});

  useEffect(() => {
    void api.rooms.list().then(setRooms);
  }, []);

  const floors = useFloorPresence(rooms.map((r) => ({ id: r.id, name: r.name })));

  return (
    <section aria-labelledby="floor-presence-heading">
      <h2 id="floor-presence-heading">{t.floorPresence.title}</h2>
      {rooms.map((room) => (
        <RoomPresenceSubscriber
          key={room.id}
          roomId={room.id}
          onUpdate={(roomId, snapshot) => setUpdates((prev) => ({ ...prev, [roomId]: snapshot }))}
        />
      ))}
      {floors.map((floor) => (
        <RoomAvatarRow key={floor.roomId} room={floor} />
      ))}
    </section>
  );
}
```

```tsx
// src/features/floor-presence/FloorSheet.tsx
import { t } from "@/lib/i18n";
import type { FloorRoomPresence } from "@/features/floor-presence/useFloorPresence";

interface FloorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floors: FloorRoomPresence[];
  currentUserId: string;
}

/** "כל המחלקה" expansion — per-person list (join time not tracked yet by
 * the underlying presence-store, so this shows name + you-marker only;
 * join-time requires a server-side change out of this task's zero-new-backend scope). */
export function FloorSheet({ open, onOpenChange, floors, currentUserId }: FloorSheetProps) {
  if (!open) return null;
  const allMembers = floors.flatMap((f) => f.members.map((m) => ({ ...m, roomName: f.roomName })));
  return (
    <div role="dialog" aria-label={t.floorPresence.wholeFloor} onClick={() => onOpenChange(false)}>
      <h2>{t.floorPresence.wholeFloor}</h2>
      <ul>
        {allMembers.map((m) => (
          <li key={m.userId}>
            {m.displayName} — {m.roomName}
            {m.userId === currentUserId ? ` (${t.floorPresence.youMarker})` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/floor-presence/FloorPresenceCard.test.tsx -v`
Expected: `Tests  1 passed (1)` (once Task 8's i18n keys exist — same ordering note as Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/features/floor-presence/FloorPresenceCard.tsx src/features/floor-presence/FloorSheet.tsx tests/floor-presence/FloorPresenceCard.test.tsx
git commit -m "feat(2.0): Task 2.3 — FloorPresenceCard + FloorSheet expansion"
```

---

## Task 8: i18n keys — `floorPresence.*` (both locales + hand-built wiring)

**Files:**
- Modify: `locales/he.json`, `locales/en.json`
- Modify: `src/lib/i18n.ts` (hand-built `translations` object)

**Interfaces:** None beyond the `t.floorPresence.*` accessor Tasks 6–7 already reference.

- [ ] **Step 1: Add the JSON keys (Hebrew first)**

In `locales/he.json`, add a new top-level key:

```json
"floorPresence": {
  "title": "מי במחלקה",
  "fresh": "עכשיו",
  "stale": "ייתכן שהשתנה",
  "emptyRoom": "אין צוות בחדר",
  "wholeFloor": "כל המחלקה",
  "youMarker": "את/ה"
}
```

In `locales/en.json`, add the parity key:

```json
"floorPresence": {
  "title": "Who's on the floor",
  "fresh": "now",
  "stale": "may have changed",
  "emptyRoom": "No staff in this room",
  "wholeFloor": "Whole floor",
  "youMarker": "you"
}
```

- [ ] **Step 2: Wire the namespace into the hand-built `translations` object**

`t` is hand-built in `src/lib/i18n.ts` — a JSON key + regenerated `.d.ts` is not enough (the real gotcha
flagged this session: `nfc.error` needed the same treatment). Add, next to the existing `rooms: d.rooms,`
line (`src/lib/i18n.ts:529`):

```typescript
  floorPresence: d.floorPresence,
```

- [ ] **Step 3: Regenerate types + verify parity**

Run: `pnpm i18n:check` — expect parity pass (no missing keys either side).
Run: `tsx scripts/i18n/generate-types.ts` (or the repo's documented codegen command) to refresh
`src/lib/i18n.generated.d.ts`.
Run: `npx tsc --noEmit` — expect 0 errors (this is what makes `t.floorPresence.title` etc. type-check in
Tasks 6–7).

- [ ] **Step 4: Re-run Tasks 6–7's tests now that the namespace exists**

Run: `npx vitest run tests/floor-presence/ -v`
Expected: all floor-presence tests green now, including the ones deferred in Tasks 6–7's Step 4.

- [ ] **Step 5: Commit**

```bash
git add locales/he.json locales/en.json src/lib/i18n.ts src/lib/i18n.generated.d.ts
git commit -m "feat(2.0): Task 2.3 — floorPresence i18n namespace (he+en, hand-built wiring)"
```

---

## Task 9: Wire `FloorPresenceCard` into the home screen + visual evidence

**Files:**
- Modify: `src/pages/home.tsx`

**Interfaces:**
- Consumes: `FloorPresenceCard` (Task 7).

- [ ] **Step 1: Add the import and mount point**

In `src/pages/home.tsx`, import and render `<FloorPresenceCard />` inside the existing home card grid
(follow the placement/spacing convention of the grid's other cards at the point of editing — read the
current file before picking the exact insertion line, since the grid's layout may have shifted since this
plan was written).

- [ ] **Step 2: Full test suite + typecheck**

Run: `pnpm test` — expect no new failures.
Run: `npx tsc --noEmit` (both tsconfigs) — expect 0 errors.
Run: `pnpm i18n:check` — expect parity pass.

- [ ] **Step 3: Visual evidence**

Start the dev server (`pnpm dev`), open the home page in a browser at 320px/768px/1024px widths, in
Hebrew (default) and English, and screenshot each. Confirm: the empty-room row is visible (not hidden),
the stale state shows amber border + text copy (not colour alone), and RTL layout is correct in Hebrew
(avatar row direction, text alignment).

- [ ] **Step 4: PROOF_ALIGNMENT_LOG entry**

Add an entry to `docs/audit/PROOF_ALIGNMENT_LOG.md` per the repo's existing format, citing the actual
`pnpm test` / `tsc` / `i18n:check` output and the screenshot set — not a summary.

- [ ] **Step 5: Commit + flip the roadmap tracker box**

```bash
git add src/pages/home.tsx docs/audit/PROOF_ALIGNMENT_LOG.md
git commit -m "feat(2.0): Task 2.3 — mount FloorPresenceCard on home (visual evidence attached)"
```

Then, per `docs/vettrack-2.0-roadmap.md`'s own rule ("independent fresh-context review before flipping a
tracker box"), get that review before changing `- [ ] 2.3 "Who's on the floor" glance card` to `- [x]`.

---

## Already complete (no tasks needed — cited, not re-derived)

**Layer 3 — RN-migration + stack-currency research.** Done as research this session, folded into this
same file's history (see git log for this file) and summarized in the Program Map above:
- Bare-RN-CLI vs Expo: New Architecture default since 0.76 (0.82 deleted the legacy Bridge); Clerk has no
  official bare-RN SDK (`install-expo-modules` is Expo's own first-party path for bare-RN-CLI, not a
  hack — still needs a spike); MMKV's JSI-synchronous design is the New-Architecture-native offline-storage
  pattern; `@vettrack/contracts` (`packages/contracts/`) is confirmed framework-free (zero deps, zero
  non-relative imports).
- Stack currency: React 19 non-urgent, Express 5 worth scheduling (no forcing function), Drizzle ORM has
  an active v1.0.0-beta with a breaking migration — do not touch yet.
- Indoor positioning (RFID/BLE/geo-location merged into one question): a real business-case doc already
  exists — `docs/business-case/2026-07-12-massive-01-passive-tracking-cost-benefit.md` — recommending an
  RFID-gate pilot first. `react-native-ble-plx` has an open New Architecture compatibility issue (#1277) —
  a real spike risk for a future Layer 5. Handheld RFID readers are a distinct hardware category from the
  existing fixed-gate system (ADR-004).

---

## Scoped, not bite-sized (blocked on decisions or foundations that don't exist yet)

Per this skill's own "No Placeholders" rule, these are deliberately **not** broken into fake 5-minute
steps — inventing file paths or code for a repo that doesn't exist, or a decision that hasn't been made,
would violate that rule in the opposite direction. Each gets its own breakdown-first plan doc once
unblocked, per `docs/vettrack-2.0-roadmap.md`'s existing convention.

**Layer 1 — 27-screen Claude Design pass.** Fully scoped in `docs/plans/design-pass-27-screens.md`
(real-file mapping for all 17 existing-screen turns, per-screen workflow, risk notes). Not bite-sized here
because the owner explicitly wants each of the 17 existing-screen turns individually greenlit before any
implementation starts — the next screen (Home/Today, turn 1) needs that greenlight, not a pre-written
task list, per the owner's own "screen-by-screen" decision.

**Layer 2 — Ship Android (Google Play Console).** Already Task 1.3 in `docs/vettrack-2.0-roadmap.md`.
Involves real manual steps (keystore generation, Play Console listing, Data-safety form, content rating)
that aren't code tasks — a bite-sized breakdown belongs in its own `docs/plans/2.0/task-1.3-android-ship.md`
per the roadmap's "breakdown-first" convention, written when that task is actively picked up.

**Layer 4 — ADR-008 (bare-RN decision) + literate-dollop disposition.** Blocked on Layer 3a's research
(done above) getting an explicit owner sign-off that no hard blocker was found, before The Architect
writes the actual ADR. The literate-dollop delete-vs-archive decision and the "lessons learned" note are
both flagged in this plan's history as needing their own explicit confirmation at execution time — not
bundled into any other approval.

**Layer 5 — Bare-RN migration (new repo).** Cannot be bite-sized: the target repo doesn't exist yet, and
its scaffolding choices (New Architecture config, build tooling) are themselves gated on ADR-008. Once
that ADR lands, this becomes its own writing-plans-style document scoped against the real new repo.

**Layer 6 — Platform-wide quality upgrade.** Not a standalone track — a standing lens applied inside
Layers 1/2/5 as each lands, per this plan's own earlier reasoning (Layer 1 already carries most of the
UI-prettiness intent; Layer 5 is the real opportunity to fix UX/backend friction).

**Task 1.4 — Consumable-usage capture.** Already in `docs/vettrack-2.0-roadmap.md` as a full spec.
**Explicitly not to be implemented** per direct owner instruction ("don't implement... I repeat don't
implement") — included here only for completeness of the program map, not as a task to execute.

---

## Model + effort routing per layer/task

Per the owner's standing operating mode (research-first, decisive, explicit model+effort per task — see
memory `feedback_deep_research_first_operating_mode.md`), using `.claude/commands/model-route.md`'s real
heuristic: **haiku** = deterministic/low-risk mechanical; **sonnet** = default implementation/refactor;
**opus** = architecture/deep-review/ambiguous requirements. Effort tiers (low/medium/high/xhigh/max)
layered on top per how ambiguous/high-stakes the task is.

| Layer / task | Model | Effort | Why |
|---|---|---|---|
| Task 1 — ADR-006 checkbox fix | haiku | low | Deterministic, mechanical, zero ambiguity |
| Tasks 2–4 — Pilot-fix route tests | sonnet | medium | Established test convention to follow, real but bounded logic |
| Task 5–9 — Task 2.3 "Who's on the floor" | sonnet | medium | Bounded feature, architecture already resolved |
| Task 10 — RFID header-spelling fix | sonnet | medium | Small, bounded, but touches rate-limiting/multi-tenancy — needs care, not deep architecture judgment |
| docs/ deep-scan research passes | sonnet | medium | Research breadth over architectural judgment |
| Layer 1 — 27-screen design pass: per-screen implementation | sonnet | medium | Follows an established design-system/component pattern per screen |
| Layer 1 — Code Blue / TV Board screens specifically | opus | high | Frozen-surface risk, cosmetic-only constraint must be judged carefully |
| Layer 2 — Android ship (code/config) | sonnet | medium | Mostly mechanical shell/signing work, established script pattern |
| Layer 3 — RN-migration + stack-currency + indoor-positioning research | sonnet (research) | medium–high | Research breadth matters more than architectural judgment at this stage |
| Layer 4 — ADR-008 + literate-dollop disposition | opus | high | Architecture decision + destructive-repo judgment call |
| Layer 5 — bare-RN migration: scaffolding/architecture | opus | high–xhigh | Highest-ambiguity, highest-stakes layer — new repo, no existing pattern |
| Layer 5 — bare-RN migration: routine porting once scaffolded | sonnet | medium | Bounded once the architecture is set |
| Layer 6 — quality lens | (inherits host layer's model/effort) | — | Not a standalone track |
| Task 1.4 — consumable-usage capture | — | — | Explicitly spec-only, not implemented — no routing needed |

---

## Self-review

**Spec coverage:** Every concrete, ready-now item from this conversation (ADR-006 fix, pilot-fix test gap,
Task 2.3) has a bite-sized task above. Every blocked/larger item (Layers 1/2/4/5/6, Task 1.4) is named in
the Program Map with an explicit reason it isn't bite-sized yet, and a pointer to where its real plan will
live once unblocked. Nothing from the conversation is silently dropped.

**Placeholder scan:** No "TBD"/"handle appropriately"/"similar to Task N" language in the bite-sized
tasks (1–9) — every code block is complete and real, verified against actual file line numbers this
session (`server/routes/users.ts:537-608`, `server/middleware/auth.js:883-912`,
`server/lib/realtime-collab/config.ts:15`, `src/lib/i18n.ts:166,529`). Task 9's Step 1 intentionally
doesn't pin an exact insertion line in `home.tsx`, since that file's grid layout may have moved since this
plan was written — the step instructs reading the current file first rather than guessing a stale line
number, which is a deliberate accuracy choice, not a placeholder.

**Type consistency:** `FloorRoomPresence` (Task 5) is the one shape threaded through Tasks 6, 7, and 9 —
`roomId`, `roomName`, `members: {userId, displayName}[]`, `isStale`, `lastUpdatedAt` are used identically
in every later task's code. `RoomPresenceSnapshot` (Task 5's subscriber) matches the `onUpdate` callback
signature `FloorPresenceCard` (Task 7) actually passes in.

---

## Execution handoff

Plan complete and saved to `docs/plans/master-plan-2026-07.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session, batch execution with checkpoints.

Which approach?
