/**
 * @vitest-environment node
 *
 * T-46 (CLICK-PATH-028) — `confirmedName` in ScanScreen was initialized null and
 * its only setter set it back to null, so `{confirmedName && <AccountabilityConfirm/>}`
 * could never mount (verified: no non-null setter exists). Decision: remove the
 * dead mount + its unused import (and the orphaned state), rather than wire it.
 * Behaviour doesn't change (it never rendered), so the guard is a source-level
 * assertion that the dead references are gone — matching the task's verify grep.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

describe("ScanScreen — dead AccountabilityConfirm path removed (T-46)", () => {
  it("no longer references AccountabilityConfirm or the dead confirmedName state", () => {
    const src = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/features/scan/ScanScreen.tsx"),
      "utf8",
    );

    expect(src).not.toContain("AccountabilityConfirm");
    expect(src).not.toContain("confirmedName");
  });
});
