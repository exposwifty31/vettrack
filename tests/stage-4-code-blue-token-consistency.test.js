import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Stage 4 — Code Blue page (code-blue.tsx) token LOCK.
 *
 * FROZEN emergency surface: this test guards the RESTYLE (className only). The
 * clinical mutations, session lifecycle, and alert behavior must stay byte-for-
 * byte — asserted here by the presence of the load-bearing behavior markers.
 *
 * The screen renders on the fixed-dark emergency surface (NOT under `.dark`),
 * so theme-forked `-fg` tokens would break contrast in light mode. The restyle
 * therefore maps onto the theme-independent emergency-* family (+ always-vivid
 * --sys-green and the --status-sterilized blue), never hardcoded palette.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(repoRoot, "src", "pages", "code-blue.tsx"), "utf8");

describe("Stage 4 Code Blue — no hardcoded palette (restyle to tokens)", () => {
  const banned = [
    "red-300", "red-400", "red-600", "red-700", "red-800", "red-900", "red-950",
    "amber-100", "amber-200", "amber-300", "amber-400", "amber-500", "amber-700", "amber-800", "amber-900",
    "green-300", "green-400", "green-500",
    "blue-300", "blue-400", "blue-900",
    "emerald-", "indigo-", "zinc-",
  ];
  for (const token of banned) {
    it(`does not use the "${token}" palette`, () => {
      expect(src.includes(token)).toBe(false);
    });
  }
  it("reads the emergency-* + --sys-green + --status-sterilized tokens", () => {
    expect(src.includes("bg-emergency-accent")).toBe(true);
    expect(src.includes("emergency-amber")).toBe(true);
    expect(src.includes("rgb(var(--sys-green))")).toBe(true);
    expect(src.includes("hsl(var(--status-sterilized))")).toBe(true);
  });
});

describe("Stage 4 Code Blue — frozen clinical behavior intact (restyle only)", () => {
  it("keeps the server-confirmed session mutations", () => {
    expect(src.includes("api.codeBlue.sessions.start")).toBe(true);
    // R-CBF-1.3: the pocket-emergency armed screen commits through the
    // R-CBF-1.1 one-tap orchestration; the equipment-initiated path keeps the
    // classic start. Both remain server-confirmed.
    expect(src.includes("api.codeBlue.sessions.oneTap")).toBe(true);
    expect(src.includes("api.codeBlue.sessions.end")).toBe(true);
    // The emergency start is keyed by the per-gesture hold token (a fresh
    // idempotency token per gesture, persisted across retries) — no longer a
    // per-call inline UUID.
    expect(src.includes("idempotencyKey: token")).toBe(true);
    expect(src.includes("idempotencyToken: token")).toBe(true);
  });
  it("keeps the critical alert tone + session hook", () => {
    expect(src.includes("playCriticalAlertTone")).toBe(true);
    expect(src.includes("useCodeBlueSession")).toBe(true);
  });
});
