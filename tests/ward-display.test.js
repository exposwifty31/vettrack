// tests/ward-display.test.js
import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";

const routeSource = readFileSync("./server/routes/display.ts", "utf-8");
// Phase 4 C1: the former display.tsx was split into the command-board module.
// Source-scrape assertions are repointed to the file that now owns each concern;
// display.tsx is now a thin host wrapper (kiosk URL + wake-lock only).
const wrapperSource = readFileSync("./src/pages/display.tsx", "utf-8");
const screenSource = readFileSync("./src/features/command-board/CommandBoardScreen.tsx", "utf-8");
const boardSource = readFileSync("./src/features/command-board/components/CommandBoard.tsx", "utf-8");
const overlaySource = readFileSync("./src/features/command-board/components/CodeBlueOverlay.tsx", "utf-8");
const hookSource = readFileSync("./src/hooks/useDisplaySnapshot.ts", "utf-8");
const workerSource = readFileSync("./server/workers/notification.worker.ts", "utf-8");
const queueSource = readFileSync("./server/lib/queue.ts", "utf-8");

describe("Ward Display — route", () => {
  it("GET /snapshot route is defined", () => {
    expect(routeSource).toMatch(/router\.get\(["']\/snapshot["']/);
  });

  it("route requires auth", () => {
    expect(routeSource).toContain("requireAuth");
  });

  it("response includes codeBlueSession field", () => {
    expect(routeSource).toContain("codeBlueSession");
  });

  it("response includes totalOverdueCount field", () => {
    expect(routeSource).toContain("totalOverdueCount");
  });

  it("command board uses criticalUnits for primary display", () => {
    // The presentational board derives its needs-attention set from criticalUnits.
    expect(boardSource).toContain("criticalUnits");
    // The screen owns the commandBoard-vs-legacy dispatch (isDeployable fallback).
    expect(screenSource).toContain("commandBoard");
    expect(screenSource).toContain("isDeployable");
  });

  it("command board conditionally renders criticalUnits vs isDeployable", () => {
    // CommandBoard component uses criticalUnits internally
    expect(boardSource).toContain("criticalUnits");
    // CommandBoardScreen derives board from snapshot.commandBoard and passes it to CommandBoard
    expect(screenSource).toMatch(/snapshot\.commandBoard/);
    // When commandBoard is absent, the legacy fallback uses isDeployable
    expect(screenSource).toMatch(/isDeployable[\s\S]{0,50}STATUS_BG/);
  });

  it("snapshot includes equipment custody fields", () => {
    expect(routeSource).toContain("heldBy");
    expect(routeSource).toContain("lastCheckInAt");
    expect(routeSource).toContain("probableLocation");
    expect(routeSource).toContain("isDeployable");
  });
});

describe("Ward Display — Code Blue mode", () => {
  it("CommandBoardScreen renders CodeBlueOverlay when codeBlueSession is not null", () => {
    expect(screenSource).toContain("CodeBlueOverlay");
    expect(screenSource).toContain("codeBlueSession");
    // The screen must branch on codeBlueSession
    expect(screenSource).toMatch(/snapshot\.codeBlueSession[\s\S]{0,30}CodeBlueOverlay/);
  });

  it("CodeBlueOverlay uses server startedAt for timer, not Date.now()", () => {
    // Timer must reference session.startedAt, not Date.now() alone
    expect(overlaySource).toContain("session.startedAt");
  });

  it("CodeBlueOverlay is read-only — no buttons or click handlers", () => {
    // The overlay file is presentational only — no interactivity of any kind.
    expect(overlaySource).not.toContain("onClick");
    expect(overlaySource).not.toContain("<button");
    expect(overlaySource).not.toContain("<a href");
  });
});

describe("Ward Display — polling hook", () => {
  it("uses 2000ms interval when Code Blue session is active", () => {
    expect(hookSource).toContain("2_000");
    expect(hookSource).toContain("codeBlueSession");
  });

  it("uses 5000ms interval in normal mode", () => {
    expect(hookSource).toContain("5_000");
  });

  it("polls in background — refetchIntervalInBackground: true", () => {
    expect(hookSource).toContain("refetchIntervalInBackground: true");
  });

  it("keeps last-known state on error — placeholderData", () => {
    expect(hookSource).toContain("placeholderData");
    expect(hookSource).toContain("previous");
  });
});

describe("Ward Display — overdue medication job (removed)", () => {
  it("does not register scan_overdue_medications repeatable job", () => {
    expect(workerSource).not.toContain("scan_overdue_medications");
    expect(queueSource).not.toContain("overdue_medication_alert");
  });

  it("notification worker no longer scans overdue medications", () => {
    expect(workerSource).not.toContain("scanOverdueMedications");
    expect(workerSource).not.toContain("overdueNotifiedAt");
  });

  it("the board is read-only except the kiosk-hidden exit button", () => {
    // The board stays read-only: the ONLY interactive element is the exit
    // affordance (navigation-only, hidden under ?kiosk=1 for wall displays).
    expect(boardSource).toContain('data-testid="board-exit"');
    const withoutExit = boardSource.replace(
      /\{!kioskMode && \([\s\S]*?board-exit[\s\S]*?\)\}/,
      "",
    );
    expect(withoutExit).not.toContain("onClick");
    expect(withoutExit).not.toContain("<button");
    expect(withoutExit).not.toContain("<a href");
  });

  it("the display.tsx wrapper owns no realtime transport (single-owner invariant)", () => {
    // Post-extraction guard: the thin wrapper must not re-import the Phase-9
    // data path — CommandBoardScreen is its single owner.
    for (const ref of [
      "EventIngestor",
      "connectRealtime",
      "publishBuildTagGossip",
      "publishCodeBlueSeenGossip",
      "useDisplaySnapshot",
      "useDisplayHeartbeat",
      "useRealtimeReconciliation",
      "useCodeBlueKeepaliveReconciliation",
    ]) {
      expect(wrapperSource).not.toContain(ref);
    }
  });
});
