/**
 * P2-7 regression: Code Blue overlay must exclude the active CB patient from
 * the "remaining hospitalizations" list using the animal ID, not the
 * hospitalization ID.
 *
 * Before fix: h.id (hospitalization ID) was compared with session.patientId
 * (animal ID) — different ID spaces — so the CB patient was never excluded.
 */
import { describe, it, expect } from "vitest";

describe("P2-7: CB overlay patient exclusion uses animalId", () => {
  it("display.tsx filters remaining by animalId, not hospitalization id", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/pages/display.tsx", "utf8");

    expect(source).toContain("h.animalId !== session.patientId");
    expect(source).not.toContain("h.id !== session.patientId");
  });

  it("DisplaySnapshotHospitalization type includes animalId", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/types/er.ts", "utf8");

    const typeBlock = source.slice(
      source.indexOf("export interface DisplaySnapshotHospitalization"),
      source.indexOf("}", source.indexOf("export interface DisplaySnapshotHospitalization")) + 1,
    );
    expect(typeBlock).toContain("animalId: string");
  });

  it("server display route returns animalId in hospitalization data", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("server/routes/display.ts", "utf8");

    expect(source).toContain("animalId: hosp.animalId");
  });

  it("exclusion logic correctly filters by animal identity", () => {
    const hospitalizations = [
      { id: "hosp-1", animalId: "animal-A", animal: { name: "Buddy" } },
      { id: "hosp-2", animalId: "animal-B", animal: { name: "Max" } },
      { id: "hosp-3", animalId: "animal-C", animal: { name: "Luna" } },
    ];
    const cbPatientId = "animal-B";

    // Correct behavior: exclude by animalId
    const remaining = hospitalizations.filter(
      (h) => !cbPatientId || h.animalId !== cbPatientId,
    );
    expect(remaining).toHaveLength(2);
    expect(remaining.map((h) => h.animal.name)).toEqual(["Buddy", "Luna"]);

    // Old bug: comparing h.id to animal ID would never match
    const buggyRemaining = hospitalizations.filter(
      (h) => !cbPatientId || h.id !== cbPatientId,
    );
    // Bug: all 3 remain because hosp IDs never equal animal IDs
    expect(buggyRemaining).toHaveLength(3);
  });

  it("handles null patientId by showing all hospitalizations", () => {
    const hospitalizations = [
      { id: "hosp-1", animalId: "animal-A", animal: { name: "Buddy" } },
      { id: "hosp-2", animalId: "animal-B", animal: { name: "Max" } },
    ];
    const cbPatientId: string | null = null;

    const remaining = hospitalizations.filter(
      (h) => !cbPatientId || h.animalId !== cbPatientId,
    );
    expect(remaining).toHaveLength(2);
  });
});
