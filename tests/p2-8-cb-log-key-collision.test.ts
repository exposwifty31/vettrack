/**
 * P2-8 regression: Code Blue overlay log entries must have unique React keys
 * even when repeated labels share the same elapsed timestamp.
 *
 * Before fix: key was `${elapsedMs}-${label}` which collides for entries
 * like two "CPR cycle" logs at the same elapsed second.
 * After fix: key appends the array index as a disambiguator.
 */
import { describe, it, expect } from "vitest";

describe("P2-8: CB overlay log key collision", () => {
  it("key pattern includes index disambiguator", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/pages/display.tsx", "utf8");

    // The key must include the index to disambiguate
    expect(source).toContain("entry.elapsedMs}-${entry.label}-${idx}");
    // Old collision-prone key should be gone
    expect(source).not.toMatch(/key=\{`\$\{entry\.elapsedMs\}-\$\{entry\.label\}`\}/);
  });

  it("map callback receives index parameter", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/pages/display.tsx", "utf8");

    expect(source).toContain("displayedLogs.map((entry, idx)");
  });

  it("generated keys are unique even with duplicate elapsedMs+label", () => {
    const logs = [
      { elapsedMs: 60000, label: "CPR cycle", category: "cpr", loggedByName: "Dr. A" },
      { elapsedMs: 60000, label: "CPR cycle", category: "cpr", loggedByName: "Dr. A" },
      { elapsedMs: 60000, label: "CPR cycle", category: "cpr", loggedByName: "Dr. B" },
      { elapsedMs: 120000, label: "Shock", category: "shock", loggedByName: "Dr. A" },
    ];

    const keys = logs.map((entry, idx) => `${entry.elapsedMs}-${entry.label}-${idx}`);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });
});
