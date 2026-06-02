/**
 * PR2: display vs equipment-board mounts use distinct router factories.
 */
import { describe, it, expect } from "vitest";
import { createDisplayRouter } from "../../server/routes/display.js";

describe("display API alias router factory", () => {
  it("createDisplayRouter returns a new Router instance each call", () => {
    const displayRouter = createDisplayRouter();
    const boardRouter = createDisplayRouter();
    expect(displayRouter).not.toBe(boardRouter);
  });

  it("each router exposes snapshot and heartbeat routes", () => {
    const router = createDisplayRouter();
    const stack = router.stack as Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
    const paths = stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route!.path,
        methods: Object.keys(layer.route!.methods),
      }));
    expect(paths).toContainEqual({ path: "/snapshot", methods: expect.arrayContaining(["get"]) });
    expect(paths).toContainEqual({ path: "/heartbeat", methods: expect.arrayContaining(["post"]) });
  });
});
