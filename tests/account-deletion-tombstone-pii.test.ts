import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// CROSS-FLOW-3 regression lock (guard-test convention, like i18n-no-hebrew-in-source):
// the anonymize fallback MUST keep stripping vetLicenseNumber + avatarUrl from the
// tombstone row. The fix landed in PR #116; this pins it so a refactor of the
// .set() block cannot silently reintroduce PII retention on soft-delete.
describe("account-deletion tombstone strips all PII (CROSS-FLOW-3 lock)", () => {
  const src = readFileSync(
    path.join(process.cwd(), "server/services/account-deletion.service.ts"),
    "utf-8",
  );

  // Bounded at the next top-level function/export so later code can never
  // satisfy the assertions (review finding on the original EOF slice).
  const anonymizeStart = src.indexOf("async function anonymizeUser");
  const rest = src.slice(anonymizeStart);
  const nextBoundary = rest.slice(1).search(/\n(?:export |async function |function )/);
  const anonymizeBlock = nextBoundary === -1 ? rest : rest.slice(0, nextBoundary + 1);

  it("anonymizeUser exists", () => {
    expect(src).toContain("async function anonymizeUser");
  });

  it("nulls vetLicenseNumber on the tombstone", () => {
    expect(anonymizeBlock).toMatch(/vetLicenseNumber:\s*null/);
  });

  it("nulls avatarUrl on the tombstone", () => {
    expect(anonymizeBlock).toMatch(/avatarUrl:\s*null/);
  });
});
