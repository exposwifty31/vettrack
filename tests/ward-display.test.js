// tests/ward-display.test.js
import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";

const routeSource = readFileSync("./server/routes/display.ts", "utf-8");
const pageSource = readFileSync("./src/pages/display.tsx", "utf-8");
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

  it("equipment sorted: held units first, then non-deployable", () => {
    expect(pageSource).toContain("heldBy");
    expect(pageSource).toContain("isDeployable");
  });

  it("snapshot includes equipment custody fields", () => {
    expect(routeSource).toContain("heldBy");
    expect(routeSource).toContain("lastCheckInAt");
    expect(routeSource).toContain("probableLocation");
    expect(routeSource).toContain("isDeployable");
  });
});

describe("Ward Display — Code Blue mode", () => {
  it("WardDisplayPage renders CodeBlueOverlay when codeBlueSession is not null", () => {
    expect(pageSource).toContain("CodeBlueOverlay");
    expect(pageSource).toContain("codeBlueSession");
    // The page must branch on codeBlueSession
    expect(pageSource).toMatch(/snapshot\.codeBlueSession[\s\S]{0,30}CodeBlueOverlay/);
  });

  it("CodeBlueOverlay uses server startedAt for timer, not Date.now()", () => {
    // Timer must reference session.startedAt, not Date.now() alone
    expect(pageSource).toContain("session.startedAt");
    // Should not use Date.now() as the timer source directly
    const timerSection = pageSource.slice(pageSource.indexOf("CodeBlueOverlay"));
    expect(timerSection).toContain("startedAt");
  });

  it("CodeBlueOverlay is read-only — no buttons or click handlers", () => {
    const overlaySection = pageSource.slice(
      pageSource.indexOf("function CodeBlueOverlay"),
      pageSource.indexOf("function WardDisplayPage"),
    );
    expect(overlaySection).not.toContain("onClick");
    expect(overlaySection).not.toContain("<button");
    expect(overlaySection).not.toContain("<a href");
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

  it("WardDisplayPage contains no interactive elements (read-only)", () => {
    // Full page should have no click handlers or buttons
    expect(pageSource).not.toContain("onClick");
    expect(pageSource).not.toContain("<button");
    expect(pageSource).not.toContain("<a href");
  });
});
