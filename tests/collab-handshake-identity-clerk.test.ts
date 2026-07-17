/**
 * R-RTC-1 Phase-1 fix card C2 (RED→GREEN).
 *
 * The REAL `resolveHandshakeIdentity` must authenticate a valid Clerk bearer token
 * on a Socket.io handshake — a request that NEVER passed through `clerkMiddleware`,
 * so `req.auth` is not pre-populated. Before the fix it routed the pseudo request
 * straight into `resolveAuthUser` → `getAuth(req)`, which throws
 * "clerkMiddleware should be registered before using getAuth"; the throw is caught
 * and turned into a 401, so EVERY Clerk-mode (production) handshake rejected.
 *
 * This test mocks only the two external boundaries — `@clerk/express` (whose real
 * `getAuth` throws on an unbranded request, faithfully reproducing the bug) and the
 * DB — and drives the real resolver end to end. The fix authenticates the token via
 * `authenticateRequest` (no middleware required) and brands `req.auth`, so the
 * shared `resolveAuthUser` → `getAuth` → DB path resolves identity unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The real getAuth throws unless req.auth carries this global brand — exactly what
// clerkMiddleware installs. We reproduce that behaviour so the RED case is honest.
const CLERK_AUTH_BRAND = Symbol.for("@clerk/express.auth");

// vi.mock is hoisted above module-level statements, so the shared mock reference
// must be created via vi.hoisted to exist when the factory runs.
const { authenticateRequestMock } = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(async () => ({
    toAuth: () => ({
      userId: "clerk_user_1",
      orgId: "clinic-A",
      sessionClaims: { email: "alice@clinic.test", name: "Alice Vet" },
    }),
  })),
}));

vi.mock("@clerk/express", () => ({
  // Faithful reproduction of the real getAuth: throws when the request was not
  // decorated by clerkMiddleware (the Socket.io handshake case).
  getAuth: (req: { auth?: unknown }) => {
    const auth = req?.auth;
    if (typeof auth === "function" && (auth as Record<symbol, unknown>)[CLERK_AUTH_BRAND] === true) {
      return (auth as (o?: unknown) => unknown)();
    }
    throw new Error('The "clerkMiddleware" should be registered before using "getAuth".');
  },
  authenticateRequest: authenticateRequestMock,
  clerkClient: { users: { getUser: vi.fn() } },
}));

// DB stub: resolveAuthUser upserts the clinic + user rows; we return a canned,
// DB-sourced identity (role + clinic come from the DB row, never the token).
vi.mock("../server/db.js", () => {
  const userRow = {
    id: "db-user-1",
    clerkId: "clerk_user_1",
    email: "alice@clinic.test",
    name: "Alice Vet",
    displayName: "Alice Vet",
    role: "vet",
    status: "active",
    clinicId: "clinic-A",
    secondaryRole: null,
    deletedAt: null,
  };
  const chain: Record<string, unknown> = {};
  chain.insert = () => chain;
  chain.values = () => chain;
  chain.onConflictDoNothing = () => Promise.resolve([]);
  chain.onConflictDoUpdate = () => chain;
  chain.returning = () => Promise.resolve([userRow]);
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve([]);
  return { db: chain, clinics: {}, users: {}, displayDevices: {}, shifts: {}, shiftAdjustments: {} };
});

// Imported AFTER the mocks are registered (vi.mock is hoisted, so a static import
// is fine, but we keep it explicit for clarity).
import { resolveHandshakeIdentity } from "../server/lib/realtime-collab/identity.js";

describe("resolveHandshakeIdentity — Clerk-mode handshake auth (card C2)", () => {
  const original = { ...process.env };

  beforeEach(() => {
    authenticateRequestMock.mockClear();
    // Force Clerk mode: secret present, not explicitly disabled, non-production.
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_dummy");
    vi.stubEnv("CLERK_ENABLED", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...original };
  });

  it("authenticates a valid Clerk token on a handshake where req.auth is NOT pre-populated (no 401)", async () => {
    const identity = await resolveHandshakeIdentity("valid.clerk.jwt", {});

    // Before the fix this is null (getAuth throws → resolveAuthUser 401). After the
    // fix the token is authenticated via authenticateRequest and identity resolves.
    expect(identity).not.toBeNull();
    expect(identity).toEqual({
      userId: "db-user-1",
      clinicId: "clinic-A",
      role: "vet",
      displayName: "Alice Vet",
    });
    // The bearer token was authenticated WITHOUT relying on clerkMiddleware.
    expect(authenticateRequestMock).toHaveBeenCalledTimes(1);
  });

  it("dev-bypass mode still resolves an identity without touching Clerk", async () => {
    // CLERK_ENABLED=false forces dev-bypass regardless of a present secret.
    vi.stubEnv("CLERK_ENABLED", "false");
    const identity = await resolveHandshakeIdentity("ignored-in-dev-bypass", {});

    expect(identity).not.toBeNull();
    expect(identity?.clinicId).toBe("dev-clinic-default");
    // Dev-bypass never reaches the Clerk handshake authentication path.
    expect(authenticateRequestMock).not.toHaveBeenCalled();
  });
});
