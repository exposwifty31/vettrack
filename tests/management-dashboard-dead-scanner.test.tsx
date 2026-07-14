/**
 * @vitest-environment node
 *
 * T-51 (CLICK-PATH-033) — `scannerOpen` was initialized false and
 * `setScannerOpen(true)` was never called, so `{scannerOpen && <QrScanner/>}`
 * could never mount (verified: no caller). Decision: remove the dead scanner
 * mount, the orphaned state, and the unused QrScanner + QrCode imports rather
 * than wire it. Behaviour doesn't change, so the guard is a source-level
 * assertion the dead references are gone — matching the task's verify grep.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/pages/management-dashboard.tsx"),
  "utf8",
);

describe("management-dashboard — dead scanner path removed (T-51)", () => {
  it("no longer references QrScanner, setScannerOpen, or the unused QrCode import", () => {
    expect(src).not.toContain("QrScanner");
    expect(src).not.toContain("setScannerOpen");
    expect(src).not.toContain("QrCode");
  });
});
