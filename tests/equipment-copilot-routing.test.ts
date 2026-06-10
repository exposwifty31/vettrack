import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const copilotRouteSource = readFileSync(
  join(process.cwd(), "server/routes/equipment-copilot.ts"),
  "utf8",
);
const appRoutesSource = readFileSync(join(process.cwd(), "server/app/routes.ts"), "utf8");

describe("equipment copilot routing contract", () => {
  it("scopes requireCopilotEnabled to the explain route, not the whole router", () => {
    expect(copilotRouteSource).not.toMatch(/router\.use\(requireCopilotEnabled\)/);
    expect(copilotRouteSource).toContain('"/:id/copilot/explain"');
    expect(copilotRouteSource).toContain("requireCopilotEnabled");
  });

  it("mounts main equipment routes before copilot nested routes", () => {
    const equipmentIdx = appRoutesSource.indexOf('app.use("/api/equipment", equipmentRoutes)');
    const copilotIdx = appRoutesSource.indexOf(
      'app.use("/api/equipment", equipmentCopilotRoutes)',
    );
    expect(equipmentIdx).toBeGreaterThan(-1);
    expect(copilotIdx).toBeGreaterThan(-1);
    expect(equipmentIdx).toBeLessThan(copilotIdx);
  });
});
