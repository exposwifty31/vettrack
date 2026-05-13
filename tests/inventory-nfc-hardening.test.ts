/**
 * Static-analysis tests for inventory NFC hardening (PR 1.2).
 *
 * Verifies:
 *  1. Cold-cache abort — fallback NFC path bails when detailsQ.data is missing
 *  2. Monotonic NFC count tracking via nfcItemCountsRef (no more always-sending-1)
 *  3. Stale closure fix — handleNFCTagRef kept current via useEffect
 *  4. api.restock.scan sends observedQuantity (not delta)
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const page = read("src/pages/inventory-page.tsx");
const apiClient = read("src/lib/api.ts");

// ─────────────────────────────────────────────────────────────────────────────
// api.ts — observedQuantity parameter
// ─────────────────────────────────────────────────────────────────────────────

describe("api.restock.scan — observedQuantity parameter", () => {
  it("scan function accepts observedQuantity (not delta)", () => {
    const scanFnStart = apiClient.indexOf("scan: (sessionId: string");
    expect(scanFnStart).toBeGreaterThan(-1);
    const scanFnEnd = apiClient.indexOf("),\n", scanFnStart);
    const scanFn = apiClient.slice(scanFnStart, scanFnEnd > scanFnStart ? scanFnEnd + 10 : scanFnStart + 400);
    expect(scanFn).toContain("observedQuantity: number");
  });

  it("scan request body includes observedQuantity spread", () => {
    const scanFnStart = apiClient.indexOf("scan: (sessionId: string");
    const scanFn = apiClient.slice(scanFnStart, scanFnStart + 700);
    expect(scanFn).toContain("body: JSON.stringify({ sessionId, ...params })");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inventory-page.tsx — stale closure fix
// ─────────────────────────────────────────────────────────────────────────────

describe("handleNFCTag — stale closure fix", () => {
  it("handleNFCTagRef is declared as a useRef", () => {
    expect(page).toContain("handleNFCTagRef");
    expect(page).toMatch(/handleNFCTagRef\s*=\s*useRef/);
  });

  it("handleNFCTagRef.current is updated via useEffect when handleNFCTag changes", () => {
    expect(page).toMatch(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{\s*handleNFCTagRef\.current\s*=\s*handleNFCTag/);
  });

  it("ndef.onreading uses handleNFCTagRef.current instead of direct handleNFCTag", () => {
    expect(page).toContain("handleNFCTagRef.current(event.serialNumber");
    expect(page).not.toMatch(/ndef\.onreading\s*=\s*\(event[^)]*\)\s*=>\s*handleNFCTag\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inventory-page.tsx — monotonic NFC count tracking
// ─────────────────────────────────────────────────────────────────────────────

describe("NFC fallback — monotonic count tracking", () => {
  it("nfcItemCountsRef is declared as a useRef<Map>", () => {
    expect(page).toContain("nfcItemCountsRef");
    expect(page).toMatch(/nfcItemCountsRef\s*=\s*useRef.*Map/);
  });

  it("nfcItemCountsRef is cleared when session ends", () => {
    expect(page).toContain("nfcItemCountsRef.current.clear()");
  });

  it("nfcItemCountsRef.current.set is called on each NFC scan in fallback path", () => {
    expect(page).toContain("nfcItemCountsRef.current.set(tagId");
  });

  it("previous count is read from nfcItemCountsRef on each scan", () => {
    expect(page).toContain("nfcItemCountsRef.current.get(tagId)");
  });

  it("count is rolled back in .catch() on scan failure", () => {
    const fallbackIdx = page.indexOf("nfcItemCountsRef.current.set(tagId");
    const catchIdx = page.indexOf(".catch(", fallbackIdx);
    expect(catchIdx).toBeGreaterThan(fallbackIdx);
    const catchBlock = page.slice(catchIdx, catchIdx + 200);
    expect(catchBlock).toContain("nfcItemCountsRef.current.set(tagId, prevCount)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inventory-page.tsx — cache patch correctness
// ─────────────────────────────────────────────────────────────────────────────

describe("scanLine — cache patch correctness", () => {
  it("setQueryData patches both actual and sessionObservedQuantity", () => {
    // There are two setQueryData calls; the scanLine patch is the one inside
    // the 'Patch cache in-place' comment block
    const anchorIdx = page.indexOf("Patch cache in-place");
    expect(anchorIdx).toBeGreaterThan(-1);
    const patchIdx = page.indexOf("setQueryData<ContainerItemsResponse>", anchorIdx);
    expect(patchIdx).toBeGreaterThan(-1);
    const patchBlock = page.slice(patchIdx, patchIdx + 400);
    expect(patchBlock).toContain("actual: nextValue");
    expect(patchBlock).toContain("sessionObservedQuantity: nextValue");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inventory-page.tsx — cold-cache abort
// ─────────────────────────────────────────────────────────────────────────────

describe("NFC fallback — cold-cache abort", () => {
  it("aborts when detailsQ.data is not available (cache is cold)", () => {
    const fallbackSection = page.slice(
      page.indexOf("Fallback: item tag found"),
      page.indexOf("nfcItemCountsRef.current.set(tagId") + 200,
    );
    expect(fallbackSection).toContain("!detailsQ.data");
  });
});
