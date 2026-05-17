import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * QR scan-line animation structural lockfile (Phase 6 PR 6.1 pre-flight fix).
 *
 * The pre-flight fix folded into PR 6.1 replaced the ping-pong keyframes
 * (`0%, 100% { 0 } 50% { 248px }` + `ease-in-out`) with one-way keyframes
 * (`from`/`to`) and `linear infinite alternate`. The prior shape made the
 * line appear pinned near the top on mobile Safari because ease-in-out
 * dwells at keyframe endpoints, and a symmetric ping-pong with two
 * endpoints at the top concentrated the dwell time there.
 *
 * This is a structural lockfile: it verifies the CSS shape stays in place.
 * Visual verification on mobile Safari is a separate manual step listed in
 * the PR description.
 */

const INDEX_CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf-8");

describe("QR scan-line CSS animation (Phase 6 PR 6.1 pre-flight)", () => {
  it("defines one-way keyframes from translate3d(0,0,0) to translate3d(0,248px,0)", () => {
    expect(INDEX_CSS).toMatch(/@keyframes\s+qr-scan-line\s*\{[\s\S]*?from\s*\{\s*transform:\s*translate3d\(0,\s*0,\s*0\)\s*;\s*\}/);
    expect(INDEX_CSS).toMatch(/@keyframes\s+qr-scan-line\s*\{[\s\S]*?to\s*\{\s*transform:\s*translate3d\(0,\s*248px,\s*0\)\s*;\s*\}/);
  });

  it("does NOT use the legacy ping-pong shape (0%,100% + 50%)", () => {
    const keyframesMatch = INDEX_CSS.match(/@keyframes\s+qr-scan-line\s*\{[\s\S]*?\n\}/);
    expect(keyframesMatch).not.toBeNull();
    const body = keyframesMatch?.[0] ?? "";
    expect(body).not.toMatch(/0%\s*,\s*100%/);
    expect(body).not.toMatch(/\b50%\s*\{/);
  });

  it(".qr-scan-line applies the animation with `infinite alternate`", () => {
    expect(INDEX_CSS).toMatch(
      /\.qr-scan-line\s*\{[\s\S]*?animation:\s*qr-scan-line\s+[\d.]+s\s+\w[\w-]*\s+infinite\s+alternate\s*;/,
    );
  });

  it(".qr-scan-line uses linear timing (constant-velocity sweep, no endpoint dwell)", () => {
    expect(INDEX_CSS).toMatch(
      /\.qr-scan-line\s*\{[\s\S]*?animation:\s*qr-scan-line\s+[\d.]+s\s+linear\s+infinite\s+alternate\s*;/,
    );
  });

  it("preserves the existing GPU-acceleration hint (will-change: transform)", () => {
    expect(INDEX_CSS).toMatch(/\.qr-scan-line\s*\{[\s\S]*?will-change:\s*transform\s*;/);
  });

  it("is honored by the prefers-reduced-motion opt-out block", () => {
    const reducedBlock = INDEX_CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.qr-scan-line[\s\S]*?animation:\s*none\s*!important/,
    );
    expect(reducedBlock).not.toBeNull();
  });
});
