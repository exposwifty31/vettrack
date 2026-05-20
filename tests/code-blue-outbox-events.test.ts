/**
 * Phase 10 P1-5 regression: CB start and end must emit
 * CODE_BLUE_STATUS_CHANGED outbox events for display propagation.
 */
import { describe, it, expect } from "vitest";

describe("P1-5: Code Blue outbox event emission", () => {
  it("POST /sessions emits CODE_BLUE_STATUS_CHANGED in start TX", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("server/routes/code-blue.ts", "utf8");
    const startSection = source.slice(
      source.indexOf("tx.insert(codeBlueSessions)"),
      source.indexOf("postSystemMessage(clinicId, \"code_blue_start\""),
    );
    expect(startSection).toContain("CODE_BLUE_STATUS_CHANGED");
    expect(startSection).toContain('"active"');
  });

  it("PATCH /end emits CODE_BLUE_STATUS_CHANGED in end TX", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("server/routes/code-blue.ts", "utf8");
    const endSetIdx = source.indexOf('set({ status: "ended"');
    const archiveIdx = source.indexOf("Archive to vt_code_blue_events");
    expect(endSetIdx).toBeGreaterThan(0);
    expect(archiveIdx).toBeGreaterThan(endSetIdx);
    const endSection = source.slice(endSetIdx, archiveIdx);
    expect(endSection).toContain("CODE_BLUE_STATUS_CHANGED");
    expect(endSection).toContain('"ended"');
  });

  it("event-reducer handles CODE_BLUE_STATUS_CHANGED like PATIENT_STATUS_UPDATED", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/event-reducer.ts", "utf8");
    expect(source).toContain('"CODE_BLUE_STATUS_CHANGED"');
  });
});
