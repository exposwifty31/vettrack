/**
 * @vitest-environment happy-dom
 *
 * Phase 0 role-testing enabler. Proves the dev-only role override is:
 *   1. read from localStorage and attached to every /api/ request in dev-bypass,
 *   2. INERT in a Clerk build (the switcher never leaks an override to production),
 *   3. limited to the server-honored role set (alias roles collapse to `student`).
 *
 * The client signal for "dev-bypass" is the ABSENCE of VITE_CLERK_PUBLISHABLE_KEY
 * (mirrors the server's `resolveAuthModeFromEnv().mode === "dev-bypass"` gate,
 * which we are fenced out of touching in Phase 0).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authFetch,
  DEV_ROLE_OVERRIDE_KEY,
  getDevRoleOverride,
  isDevBypassBuild,
  isDevOverrideRole,
} from "@/lib/auth-fetch";
import { setAuthState } from "@/lib/auth-store";

const CLERK_KEY = "pk_test_abc123";

/** present=false → empty key → dev-bypass build; present=true → Clerk build. */
function stubClerk(present: boolean) {
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", present ? CLERK_KEY : "");
}

describe("dev-role override helpers", () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    setAuthState({ userId: "dev-admin-001", email: "a@b.dev", name: "Dev", bearerToken: null });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.localStorage?.clear();
  });

  it("isDevOverrideRole accepts only the server-honored roles", () => {
    expect(isDevOverrideRole("admin")).toBe(true);
    expect(isDevOverrideRole("senior_technician")).toBe(true);
    expect(isDevOverrideRole("technician")).toBe(true);
    // Alias roles collapse to `student` server-side, so the switcher must not offer them.
    expect(isDevOverrideRole("lead_technician")).toBe(false);
    expect(isDevOverrideRole("vet_tech")).toBe(false);
    expect(isDevOverrideRole("nonsense")).toBe(false);
    expect(isDevOverrideRole(null)).toBe(false);
  });

  it("returns the stored role in a dev-bypass build", () => {
    stubClerk(false);
    localStorage.setItem(DEV_ROLE_OVERRIDE_KEY, "senior_technician");
    expect(isDevBypassBuild()).toBe(true);
    expect(getDevRoleOverride()).toBe("senior_technician");
  });

  it("returns null for an absent or non-server-honored stored role", () => {
    stubClerk(false);
    expect(getDevRoleOverride()).toBeNull();
    localStorage.setItem(DEV_ROLE_OVERRIDE_KEY, "lead_technician");
    expect(getDevRoleOverride()).toBeNull();
  });

  it("is INERT in a Clerk build: a stored role is ignored", () => {
    stubClerk(true);
    localStorage.setItem(DEV_ROLE_OVERRIDE_KEY, "vet");
    expect(isDevBypassBuild()).toBe(false);
    expect(getDevRoleOverride()).toBeNull();
  });
});

describe("authFetch dev-role header wiring", () => {
  let captured: RequestInit | undefined;

  beforeEach(() => {
    captured = undefined;
    globalThis.localStorage?.clear();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      captured = init;
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    globalThis.localStorage?.clear();
  });

  function overrideHeader(init: RequestInit | undefined): string | null {
    const h = init?.headers;
    return h instanceof Headers ? h.get("x-dev-role-override") : null;
  }

  it("attaches x-dev-role-override on an /api/ call in dev-bypass", async () => {
    stubClerk(false);
    setAuthState({ userId: "dev-admin-001", email: "a@b.dev", name: "Dev", bearerToken: null });
    localStorage.setItem(DEV_ROLE_OVERRIDE_KEY, "technician");
    await authFetch("/api/anything");
    expect(overrideHeader(captured)).toBe("technician");
  });

  it("omits the header in a Clerk build even when a role is stored", async () => {
    stubClerk(true);
    // Clerk mode requires a valid JWT or authFetch rejects before reaching fetch.
    setAuthState({ userId: "user-1", email: "a@b.dev", name: "U", bearerToken: "aaa.bbb.ccc" });
    localStorage.setItem(DEV_ROLE_OVERRIDE_KEY, "vet");
    await authFetch("/api/anything");
    expect(overrideHeader(captured)).toBeNull();
  });
});
