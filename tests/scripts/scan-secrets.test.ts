import { describe, it, expect } from "vitest";

import { isAllowedHit, shouldExclude } from "../../scripts/scan-secrets";

describe("scan-secrets allowlist", () => {
  it("allows localhost fixture database URLs in tests", () => {
    expect(
      isAllowedHit(
        "Database URL with credentials",
        "tests/integration/sample.test.ts",
        "const DATABASE_URL = 'postgres://vettrack:vettrack@localhost:5432/vettrack';",
      ),
    ).toBe(true);
  });

  it("does not allow non-local database URLs in tests", () => {
    expect(
      isAllowedHit(
        "Database URL with credentials",
        "tests/integration/sample.test.ts",
        "const DATABASE_URL = 'postgres://<redacted-credentials>@db.example.com:5432/prod';",
      ),
    ).toBe(false);
  });

  it("does not allow matches for non-allowlisted paths", () => {
    expect(
      isAllowedHit(
        "Database URL with credentials",
        "server/config.ts",
        "DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack",
      ),
    ).toBe(false);
  });

  it("allows the genuine PEM-header startsWith validation line", () => {
    expect(
      isAllowedHit(
        "Private key block",
        ".agents/skills/publish-mobile-app/scripts/bootstrap-app-store-key.ts",
        'if (!pem.startsWith("-----BEGIN PRIVATE KEY-----")) throw new Error("bad key");',
      ),
    ).toBe(true);
  });

  it("does not allow a real PEM hiding on the same line as the startsWith validation", () => {
    expect(
      isAllowedHit(
        "Private key block",
        ".agents/skills/publish-mobile-app/scripts/bootstrap-app-store-key.ts",
        'if (key.startsWith("-----BEGIN PRIVATE KEY-----")) return; const leaked = "-----BEGIN RSA PRIVATE KEY-----MIIEvQ";',
      ),
    ).toBe(false);
  });
});

describe("scan-secrets exclusions", () => {
  it("excludes scanner script and env files", () => {
    expect(shouldExclude("scripts/scan-secrets.ts")).toBe(true);
    expect(shouldExclude(".env")).toBe(true);
  });

  it("does not exclude arbitrary source files", () => {
    expect(shouldExclude("server/routes/equipment.ts")).toBe(false);
  });
});
