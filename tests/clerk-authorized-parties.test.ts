import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAzpAllowed, resolveClerkAuthorizedParties } from "../server/lib/clerk-authorized-parties.js";

describe("resolveClerkAuthorizedParties", () => {
  const prevAllowed = process.env.ALLOWED_ORIGIN;

  beforeEach(() => {
    process.env.ALLOWED_ORIGIN = "https://vettrack.uk";
  });

  afterEach(() => {
    if (prevAllowed === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = prevAllowed;
  });

  it("includes Capacitor shell origins and production web host", () => {
    const parties = resolveClerkAuthorizedParties(true);
    expect(parties).toContain("capacitor://localhost");
    expect(parties).toContain("ionic://localhost");
    expect(parties).toContain("https://vettrack.uk");
    expect(parties).toContain("https://www.vettrack.uk");
  });

  it("includes localhost dev origins outside production", () => {
    const parties = resolveClerkAuthorizedParties(false);
    expect(parties).toContain("http://localhost:5000");
    expect(parties).toContain("http://localhost:3001");
  });

  it("does not double-prefix www when ALLOWED_ORIGIN already has www", () => {
    process.env.ALLOWED_ORIGIN = "https://www.vettrack.uk";
    const parties = resolveClerkAuthorizedParties(true);
    expect(parties).toContain("https://www.vettrack.uk");
    expect(parties).toContain("https://vettrack.uk");
    expect(parties).not.toContain("https://www.www.vettrack.uk");
  });
});

describe("isAzpAllowed (restores @clerk/backend 1.x azp semantics)", () => {
  const parties = ["https://vettrack.uk", "capacitor://localhost"];

  it("allows an ABSENT azp (undefined only) — native Expo/RN tokens are minted without one", () => {
    // @clerk/backend 3.x rejects absent azp at the middleware layer; the app-level
    // gate must skip instead, or every native session token 401s. Only a truly
    // missing key (undefined) counts as absent.
    expect(isAzpAllowed(undefined, parties)).toBe(true);
  });

  it("rejects a PRESENT-but-falsy azp — a malformed claim is not an absent claim", () => {
    expect(isAzpAllowed(null, parties)).toBe(false);
    expect(isAzpAllowed("", parties)).toBe(false);
    expect(isAzpAllowed(false, parties)).toBe(false);
    expect(isAzpAllowed(0, parties)).toBe(false);
  });

  it("allows a PRESENT azp that is in the allowlist (browser/WebView tokens)", () => {
    expect(isAzpAllowed("https://vettrack.uk", parties)).toBe(true);
    expect(isAzpAllowed("capacitor://localhost", parties)).toBe(true);
  });

  it("rejects a PRESENT azp that is NOT in the allowlist (cross-origin token reuse)", () => {
    expect(isAzpAllowed("https://evil.example", parties)).toBe(false);
  });

  it("rejects a non-string azp claim (malformed token)", () => {
    expect(isAzpAllowed(42, parties)).toBe(false);
    expect(isAzpAllowed({ azp: "x" }, parties)).toBe(false);
  });

  it("allows everything when no allowlist is configured (mirrors backend skip)", () => {
    expect(isAzpAllowed("https://anywhere.example", [])).toBe(true);
    expect(isAzpAllowed(undefined, [])).toBe(true);
  });
});
