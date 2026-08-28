import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
const routeSource = readFileSync(
  join(process.cwd(), "server/routes/equipment.ts"),
  "utf8",
);

describe("equipment routes — replay idempotency wiring", () => {
  it("mounts equipmentReplayIdempotency on offline-replayed mutation routes", () => {
    expect(routeSource).toContain("equipmentReplayIdempotency");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.checkout");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.return");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.toggle");
    expect(routeSource).toContain('"/:id/toggle"');
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.scan");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.seen");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.create");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.update");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.delete");
  });

  it("mounts equipmentReplayIdempotency on the flat quick-scan alias", () => {
    // POST /api/equipment/scan is a custody *toggle*, so an unguarded replay
    // undoes the first checkout rather than repeating it. Match the middleware
    // inside this route's own chain — a bare `toContain` would pass on a
    // `quickScan` mention anywhere else in the file.
    const quickScanChain =
      /router\.post\(\s*"\/scan",[\s\S]{0,400}?EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS\.quickScan/;
    expect(quickScanChain.test(routeSource)).toBe(true);
  });
});
