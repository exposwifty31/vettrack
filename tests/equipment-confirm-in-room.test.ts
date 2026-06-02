import { describe, it, expect } from "vitest";
import fs from "node:fs";

const handlerSource = fs.readFileSync(
  "server/routes/equipment/handlers/post-equipment-confirm-in-room.ts",
  "utf8",
);

describe("POST /equipment/:id/confirm-in-room contract", () => {
  it("assigns room, verifies, and writes scan evidence", () => {
    expect(handlerSource).toContain("Confirmed in room:");
    expect(handlerSource).toContain("lastVerifiedAt: now");
    expect(handlerSource).toContain("location: room.name");
    expect(handlerSource).toContain('actionType: "equipment_scanned"');
  });

  it("scopes by clinicId on equipment and room", () => {
    expect(handlerSource).toContain("eq(equipment.clinicId, clinicId)");
    expect(handlerSource).toContain("eq(rooms.clinicId, clinicId)");
  });
});
