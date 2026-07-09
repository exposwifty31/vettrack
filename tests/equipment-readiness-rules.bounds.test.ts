import { describe, it, expect } from "vitest";
import {
  isValidStaleEvidenceMs,
  MIN_STALE_EVIDENCE_MS,
  MAX_STALE_EVIDENCE_MS,
} from "../shared/equipment-readiness-rules.js";

describe("isValidStaleEvidenceMs (7c governance bounds)", () => {
  it("accepts values within [MIN, MAX] that are whole ms", () => {
    expect(isValidStaleEvidenceMs(MIN_STALE_EVIDENCE_MS)).toBe(true);
    expect(isValidStaleEvidenceMs(MAX_STALE_EVIDENCE_MS)).toBe(true);
    expect(isValidStaleEvidenceMs(86_400_000)).toBe(true); // default 24h
  });

  it("rejects out-of-range, non-integer, and non-finite values", () => {
    expect(isValidStaleEvidenceMs(MIN_STALE_EVIDENCE_MS - 1)).toBe(false);
    expect(isValidStaleEvidenceMs(MAX_STALE_EVIDENCE_MS + 1)).toBe(false);
    expect(isValidStaleEvidenceMs(0)).toBe(false);
    expect(isValidStaleEvidenceMs(-1)).toBe(false);
    expect(isValidStaleEvidenceMs(3_600_000.5)).toBe(false);
    expect(isValidStaleEvidenceMs(Number.NaN)).toBe(false);
  });
});
