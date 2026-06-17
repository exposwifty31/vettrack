import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  CLERK_CLIENT_JWT_STORAGE_KEY,
  isClerkSessionJwt,
  resolveNativeClerkSessionToken,
} from "@/lib/native-clerk-session-token";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

describe("native-clerk-session-token", () => {
  it("treats JWTs with sid as session tokens", () => {
    const token = fakeJwt({ sid: "sess_123", sub: "user_abc" });
    expect(isClerkSessionJwt(token)).toBe(true);
  });

  it("rejects client-shaped JWTs without sid", () => {
    const token = fakeJwt({ sts: "active", sub: "user_abc" });
    expect(isClerkSessionJwt(token)).toBe(false);
  });

  it("rejects client-shaped JWTs even when sid is accidentally present in storage checks", () => {
    const client = fakeJwt({ sts: "active" });
    expect(isClerkSessionJwt(client)).toBe(false);
  });

  describe("resolveNativeClerkSessionToken", () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
      vi.useFakeTimers();
      storage.clear();
      delete (globalThis as { Clerk?: unknown }).Clerk;
      const localStorageShim = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => storage.clear(),
        key: () => null,
        length: 0,
      };
      vi.stubGlobal("localStorage", localStorageShim);
      vi.stubGlobal("window", { localStorage: localStorageShim });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      delete (globalThis as { Clerk?: unknown }).Clerk;
    });

    it("returns the final getToken() JWT when sid detection fails but the token is not the client JWT", async () => {
      const apiToken = fakeJwt({ sub: "user_abc", sts: "active" });
      const getToken = vi.fn(async () => apiToken);

      const promise = resolveNativeClerkSessionToken(getToken);
      await vi.runAllTimersAsync();
      const token = await promise;

      expect(isClerkSessionJwt(apiToken)).toBe(false);
      expect(token).toBe(apiToken);
    });

    it("still rejects the persisted client transport JWT on the final fallback", async () => {
      const clientJwt = fakeJwt({ sts: "active" });
      storage.set(CLERK_CLIENT_JWT_STORAGE_KEY, clientJwt);
      const getToken = vi.fn(async () => clientJwt);

      const promise = resolveNativeClerkSessionToken(getToken);
      await vi.runAllTimersAsync();
      const token = await promise;

      expect(token).toBe("");
    });
  });
});
