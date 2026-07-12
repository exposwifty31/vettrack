/**
 * @vitest-environment happy-dom
 *
 * Phase 10 (T21 item 2) — the one-shot "display was revoked" notice flag.
 * `markDisplayRevokedNotice()` is called by auth-fetch.ts right before the
 * silent 401 → /board/pair redirect; `consumeDisplayRevokedNotice()` is read
 * (and cleared) exactly once by BoardPairPage so the notice never reappears
 * on a later, unrelated visit to /board/pair.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  markDisplayRevokedNotice,
  consumeDisplayRevokedNotice,
  setStoredDisplayToken,
  getStoredDisplayToken,
} from "@/lib/display-token-store";

const getCurrentUserId = vi.fn<() => string>();
const getStoredBearerToken = vi.fn<() => string | null>();

vi.mock("@/lib/auth-store", () => ({
  getCurrentUserId: () => getCurrentUserId(),
  getStoredBearerToken: () => getStoredBearerToken(),
}));
vi.mock("@/lib/api-origin", () => ({
  resolveApiUrl: (url: string) => url,
}));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  getCurrentUserId.mockReset().mockReturnValue("");
  getStoredBearerToken.mockReset().mockReturnValue(null);
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

describe("auth-fetch wiring — marks the notice before the silent redirect (runtime)", () => {
  it("marks the revoked notice, clears the stored token, and redirects to /board/pair on a 401 — driving the real authFetch, not a source-text lock", async () => {
    // Real (unmocked) display-token-store: exercises the actual flag +
    // storage side effects authFetch triggers, not just their call order.
    setStoredDisplayToken("vtd_display_secret", "clinic-A");
    expect(consumeDisplayRevokedNotice()).toBe(false); // not flagged yet

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
    window.location.href = "/board";

    const { authFetch } = await import("@/lib/auth-fetch");
    await authFetch("/api/display/snapshot");

    expect(getStoredDisplayToken()).toBeNull();
    expect(consumeDisplayRevokedNotice()).toBe(true);
    expect(window.location.pathname).toBe("/board/pair");

    vi.unstubAllGlobals();
  });
});
