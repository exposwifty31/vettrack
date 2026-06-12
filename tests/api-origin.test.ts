import { describe, expect, it } from "vitest";
import { getConfiguredApiOrigin, needsRemoteApiOrigin, resolveApiUrl } from "../src/lib/api-origin";

describe("resolveApiUrl", () => {
  it("keeps relative API paths same-origin outside the bundled native shell, even with VITE_API_ORIGIN set", () => {
    const prev = import.meta.env.VITE_API_ORIGIN;
    import.meta.env.VITE_API_ORIGIN = "https://vettrack.uk/";
    try {
      // Not a Capacitor WebView here → must stay relative so dev/test/web
      // never send API traffic to the configured production origin.
      expect(needsRemoteApiOrigin()).toBe(false);
      expect(resolveApiUrl("/api/users/me")).toBe("/api/users/me");
      expect(getConfiguredApiOrigin()).toBe("https://vettrack.uk");
    } finally {
      import.meta.env.VITE_API_ORIGIN = prev;
    }
  });

  it("trims a trailing slash from the configured origin", () => {
    const prev = import.meta.env.VITE_API_ORIGIN;
    import.meta.env.VITE_API_ORIGIN = "https://vettrack.uk/";
    try {
      expect(getConfiguredApiOrigin()).toBe("https://vettrack.uk");
    } finally {
      import.meta.env.VITE_API_ORIGIN = prev;
    }
  });

  it("leaves absolute URLs unchanged", () => {
    expect(resolveApiUrl("https://example.com/api/healthz")).toBe("https://example.com/api/healthz");
  });
});
