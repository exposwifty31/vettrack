/**
 * @vitest-environment happy-dom
 *
 * Phase 10 (T21 item 2) — the one-shot "display was revoked" notice flag.
 * `markDisplayRevokedNotice()` is called by auth-fetch.ts right before the
 * silent 401 → /board/pair redirect; `consumeDisplayRevokedNotice()` is read
 * (and cleared) exactly once by BoardPairPage so the notice never reappears
 * on a later, unrelated visit to /board/pair.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import {
  markDisplayRevokedNotice,
  consumeDisplayRevokedNotice,
} from "@/lib/display-token-store";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("display revoked-notice flag", () => {
  it("is false when never marked", () => {
    expect(consumeDisplayRevokedNotice()).toBe(false);
  });

  it("is true exactly once after marking, then false again (one-shot)", () => {
    markDisplayRevokedNotice();
    expect(consumeDisplayRevokedNotice()).toBe(true);
    expect(consumeDisplayRevokedNotice()).toBe(false);
  });

  it("is session-scoped (sessionStorage, not localStorage)", () => {
    markDisplayRevokedNotice();
    expect(window.sessionStorage.getItem("vt_display_revoked_notice")).toBe("1");
    expect(window.localStorage.getItem("vt_display_revoked_notice")).toBeNull();
  });
});

describe("auth-fetch wiring — marks the notice before the silent redirect", () => {
  it("calls markDisplayRevokedNotice() ahead of clearStoredDisplayToken() on a 401", () => {
    const source = readFileSync("src/lib/auth-fetch.ts", "utf-8");
    const markIdx = source.indexOf("markDisplayRevokedNotice()");
    const clearIdx = source.indexOf("clearStoredDisplayToken()", markIdx);
    const redirectIdx = source.indexOf('"/board/pair"', clearIdx);
    expect(markIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(markIdx);
    expect(redirectIdx).toBeGreaterThan(clearIdx);
  });
});
