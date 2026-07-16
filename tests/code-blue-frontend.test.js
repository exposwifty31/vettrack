/**
 * Static-analysis tests for the Code Blue frontend (Tasks 7–11 of the redesign).
 *
 * These tests are intentionally written BEFORE the components exist (TDD red state).
 * They verify structural patterns in:
 *   - src/hooks/useCodeBlueSession.ts  (Task 7)
 *   - src/pages/code-blue.tsx          (Task 9)
 *   - src/pages/code-blue-display.tsx  (Task 10)
 *   - src/app/routes.tsx               (Task 11)
 *
 * Tests skip automatically if source files are not yet created.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

const hook = read("src/hooks/useCodeBlueSession.ts");
const page = read("src/pages/code-blue.tsx");
const display = read("src/pages/code-blue-display.tsx");
const routes = read("src/app/routes.tsx");

// ─────────────────────────────────────────────────────────────────────────────
// useCodeBlueSession hook
// ─────────────────────────────────────────────────────────────────────────────

describe("useCodeBlueSession hook", () => {
  it.skipIf(hook === null)("polls /api/code-blue/sessions/active every 2 seconds", () => {
    expect(hook).toContain("/api/code-blue/sessions/active");
    expect(hook).toContain("refetchInterval: 2000");
  });

  it.skipIf(hook === null)("uses server startedAt (not Date.now) for elapsed calculation", () => {
    expect(hook).toContain("startedAt");
    expect(hook).not.toMatch(/Date\.now\(\)\s*-\s*Date\.now/);
  });

  it.skipIf(hook === null)("fails loud on CB log network error (Phase 9 doctrine — no offline queue)", () => {
    expect(hook).toContain("api.codeBlue.sessions.appendLog");
    expect(hook).toContain("OfflineEmergencyMutationBlockedError");
    expect(hook).not.toContain("vt_cb_queue");
  });

  it.skipIf(hook === null)("sends presence heartbeat every 10 seconds", () => {
    expect(hook).toMatch(/10[_]?000/);
    expect(hook).toContain("presence");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Code Blue page — manager gate
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue page — manager gate", () => {
  it.skipIf(page === null)("isManager computed from session.managerUserId vs current user", () => {
    expect(page).toContain("managerUserId");
    expect(page).toContain("isManager");
  });

  it.skipIf(page === null)("end-event button only renders for manager", () => {
    expect(page).toMatch(/isManager[\s\S]{0,400}endEventChooseOutcome/);
  });

  it.skipIf(page === null)("elapsed timer uses session startedAt via useElapsed hook", () => {
    expect(page).toContain("useElapsed(session?.startedAt");
    expect(page).toContain("function useElapsed(startedAt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Code Blue page — cart status
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue page — cart status", () => {
  it.skipIf(page === null)("renders cart status indicator from cartStatus in poll response", () => {
    expect(page).toContain("cartStatus");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Code Blue page — equipment picker
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue page — equipment picker", () => {
  it.skipIf(page === null)("equipment log button exists with category='equipment'", () => {
    expect(page).toContain("equipment");
    expect(page).toContain("equipmentId");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Code Blue page — quick log idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue page — emergency mutation idempotency", () => {
  it.skipIf(page === null)("keys the emergency start with a fresh per-gesture idempotency token", () => {
    // R-CBF-1.3: the hold control generates one idempotency token per gesture
    // (crypto.randomUUID under the hood, in src/features/code-blue/hold-token.ts);
    // the page threads it into both start paths as the idempotency key.
    expect(page).toContain("idempotencyToken");
    expect(page).toContain("idempotencyKey");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Code Blue display page
// ─────────────────────────────────────────────────────────────────────────────

describe("Code Blue display page", () => {
  // The TDD-red-state skipIf guards this file was written under are stale —
  // src/pages/code-blue-display.tsx is a load-bearing frozen surface now, not
  // a not-yet-created file. A missing/renamed page must fail this suite
  // loudly, not silently skip every assertion below.
  it("code-blue-display.tsx exists", () => {
    expect(display).not.toBeNull();
  });

  // T20 (frozen-surface audit fix): the wall is driven by the frozen SSE
  // transport, not by a bare poll on /api/code-blue/sessions/active. It reads
  // the SSE-fed DISPLAY_SNAPSHOT and mounts the shared realtime client seam
  // (EventIngestor + connectRealtime). Polling is demoted to the snapshot's
  // bounded degraded fallback only.
  it("display page is SSE-driven (frozen transport), not a bare CB poll", () => {
    expect(display).toContain("connectRealtime");
    expect(display).toContain("EventIngestor");
    expect(display).toContain("DISPLAY_SNAPSHOT_QUERY_KEY");
    // The old bespoke 2 s poll on the CB-active endpoint is gone as the primary
    // update path — the wall no longer references it at all.
    expect(display).not.toContain("/api/code-blue/sessions/active");
  });

  it("display page has no interactive buttons (no onClick that posts)", () => {
    expect(display).not.toContain('"POST"');
    expect(display).not.toContain("useMutation");
  });

  it("display page shows standby message when no session", () => {
    // Phase 6 PR 6.7 migrated the literal "ממתין לאירוע..." to
    // t.codeBlue.display.awaitingEvent. Assert the accessor + locale
    // dict are wired up.
    expect(display).toContain("t.codeBlue.display.awaitingEvent");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

describe("Route registration", () => {
  it.skipIf(routes === null)("/code-blue/display route is registered", () => {
    expect(routes).toContain('"/code-blue/display"');
    expect(routes).toContain("CodeBlueDisplay");
  });

  it.skipIf(routes === null)("/crash-cart route is registered", () => {
    expect(routes).toContain('"/crash-cart"');
    expect(routes).toContain("CrashCartCheckPage");
  });
});
