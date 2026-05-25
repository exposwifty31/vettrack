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
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.scan");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.seen");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.create");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.update");
    expect(routeSource).toContain("EQUIPMENT_REPLAY_IDEMPOTENCY_ENDPOINTS.delete");
  });
});
