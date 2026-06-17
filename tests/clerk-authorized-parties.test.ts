import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveClerkAuthorizedParties } from "../server/lib/clerk-authorized-parties.js";

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
});
