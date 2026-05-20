/**
 * Phase 10 P0-1 regression: Code Blue mutations must never be queued
 * offline via localStorage. The vt_cb_queue mechanism is removed; the
 * hook now fails loud with a toast + bounded telemetry counter.
 */
import { describe, it, expect } from "vitest";
import { classifyEmergencyEndpoint } from "../src/lib/offline-emergency-block";

describe("P0-1: Code Blue offline queue removed", () => {
  it("classifyEmergencyEndpoint blocks POST /sessions", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions", "POST")).toBe("start");
  });

  it("classifyEmergencyEndpoint blocks POST /sessions/:id/logs", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/logs", "POST")).toBe("log");
  });

  it("classifyEmergencyEndpoint blocks PATCH /sessions/:id/end", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/end", "PATCH")).toBe("end");
  });

  it("classifyEmergencyEndpoint blocks PATCH /sessions/:id/presence", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/abc-123/presence", "PATCH")).toBe("presence");
  });

  it("classifyEmergencyEndpoint allows GET /sessions/active (read-only)", () => {
    expect(classifyEmergencyEndpoint("/api/code-blue/sessions/active", "GET")).toBeNull();
  });

  it("useCodeBlueSession.ts no longer contains vt_cb_queue references", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/hooks/useCodeBlueSession.ts", "utf8");
    expect(source).not.toContain("vt_cb_queue");
    expect(source).not.toContain("QUEUE_KEY");
    expect(source).not.toContain("loadQueue");
    expect(source).not.toContain("saveQueue");
    expect(source).not.toContain("_flushInProgress");
    expect(source).toContain("classifyEmergencyEndpoint");
    expect(source).toContain("recordEmergencyBlockLocally");
  });
});
