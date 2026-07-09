/**
 * @vitest-environment happy-dom
 *
 * Phase 9 — display-device token attachment in the client fetch layer.
 * `authFetch` must attach the `x-display-token` header ONLY when a device token
 * is stored AND no user is signed in — a headless display path. A signed-in user
 * must never be routed through it (the normal user-auth path stays unaffected),
 * and with neither a user nor a token the request is blocked as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUserId = vi.fn<() => string>();
const getStoredBearerToken = vi.fn<() => string | null>();
const getStoredDisplayToken = vi.fn<() => string | null>();

vi.mock("@/lib/auth-store", () => ({
  getCurrentUserId: () => getCurrentUserId(),
  getStoredBearerToken: () => getStoredBearerToken(),
}));
vi.mock("@/lib/api-origin", () => ({
  resolveApiUrl: (url: string) => url,
}));
vi.mock("@/lib/display-token-store", () => ({
  getStoredDisplayToken: () => getStoredDisplayToken(),
}));

import { authFetch } from "@/lib/auth-fetch";

function lastFetchHeaders(fetchMock: ReturnType<typeof vi.fn>): Headers {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return new Headers(init.headers as HeadersInit);
}

beforeEach(() => {
  getCurrentUserId.mockReset();
  getStoredBearerToken.mockReset().mockReturnValue(null);
  getStoredDisplayToken.mockReset();
});

describe("authFetch — display-token attachment", () => {
  it("attaches x-display-token (not Authorization) when a token is stored and no user is signed in", async () => {
    getCurrentUserId.mockReturnValue("");
    getStoredDisplayToken.mockReturnValue("vtd_display_secret");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await authFetch("/api/display/snapshot");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = lastFetchHeaders(fetchMock);
    expect(headers.get("x-display-token")).toBe("vtd_display_secret");
    expect(headers.get("Authorization")).toBeNull();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
  });

  it("does NOT attach x-display-token when a user is signed in (normal path is unaffected)", async () => {
    // Even with a token present in storage, a signed-in user takes the user path.
    getCurrentUserId.mockReturnValue("user-123");
    getStoredDisplayToken.mockReturnValue("vtd_display_secret");
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await authFetch("/api/display/snapshot");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastFetchHeaders(fetchMock).get("x-display-token")).toBeNull();
  });

  it("blocks the request (AUTH_INVALID) when there is neither a user nor a stored token", async () => {
    getCurrentUserId.mockReturnValue("");
    getStoredDisplayToken.mockReturnValue(null);
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(authFetch("/api/display/snapshot")).rejects.toThrow("AUTH_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
