/**
 * The comment stripper behind the server-route manifest.
 *
 * It exists because the manifest feeds the RN repo's endpoint-drift guard, and
 * every way of getting this wrong is SILENT: a mis-parse removes route
 * declarations, the manifest comes out short, and RN's guard then passes green
 * over paths it never checked. Each case below is a real failure this scanner
 * had, not a hypothetical.
 */
import { describe, expect, it } from "vitest";

import { stripComments } from "../scripts/lib/strip-comments.mjs";

describe("stripComments", () => {
  it("removes a line comment", () => {
    expect(stripComments('router.get("/a"); // note')).toBe('router.get("/a"); ');
  });

  it("removes a block comment", () => {
    expect(stripComments('/* gone */router.get("/a");')).toBe('router.get("/a");');
  });

  it("removes a commented-out registration — the reason this exists", () => {
    expect(stripComments("// mountEquipmentWaitlistRoutes(router);")).not.toContain("mount");
  });

  it("keeps a block delimiter that lives inside a LINE comment from opening a block", () => {
    // server/app/routes.ts says "copilot nested routes (/:id/copilot/*)". Reading
    // that as an opener swallowed every app.use below it: 57 mounts became 15.
    const src = ['// nested (/:id/copilot/*) pass through', 'app.use("/api/x", xRoutes);'].join("\n");
    expect(stripComments(src)).toContain('app.use("/api/x", xRoutes);');
  });

  it("does not let a JSDoc run on into the declaration beneath it", () => {
    // Removing `*`-leading lines dropped the CLOSING delimiter while keeping the
    // opener, so each docblock ate the route below: 292 routes became 287.
    const src = ["/**", " * GET /api/restock/sessions", " */", 'router.get("/sessions", h);'].join("\n");
    expect(stripComments(src)).toContain('router.get("/sessions", h);');
  });

  it("keeps a comment delimiter that lives inside a STRING", () => {
    expect(stripComments('const u = "https://example.test/a";')).toContain("https://example.test/a");
  });

  it("keeps a REGEX LITERAL containing a comment delimiter, and the code after it", () => {
    // A legal `/[/*]/` in a route file made the walk lose that file entirely.
    const src = ['const RX = /[/*]/;', 'router.get("/after", h);'].join("\n");
    const out = stripComments(src);
    expect(out).toContain('router.get("/after", h);');
    expect(out).toContain("/[/*]/");
  });

  it("keeps an escaped slash inside a regex from terminating it early", () => {
    const src = ['const RX = /https:\\/\\//;', 'router.get("/after", h);'].join("\n");
    expect(stripComments(src)).toContain('router.get("/after", h);');
  });

  it("still treats division as division, not as a regex that swallows the line", () => {
    const src = ["const half = total / 2;", 'router.get("/after", h);'].join("\n");
    const out = stripComments(src);
    expect(out).toContain("const half = total / 2;");
    expect(out).toContain('router.get("/after", h);');
  });
});
