import { describe, it, expect } from "vitest";
import {
  chunkLoadErrorFromReason,
  isChunkLoadError,
} from "../src/lib/chunk-load-recovery";

describe("chunk-load-recovery", () => {
  it("detects Safari module import failures", () => {
    expect(isChunkLoadError("Importing a module script failed")).toBe(true);
  });

  it("detects Chrome dynamic import failures", () => {
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isChunkLoadError("Network Error")).toBe(false);
  });

  it("extracts chunk errors from Error reasons", () => {
    const msg = chunkLoadErrorFromReason(
      new Error("Importing a module script failed"),
    );
    expect(msg).toBe("Importing a module script failed");
  });
});
