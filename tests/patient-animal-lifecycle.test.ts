import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const patientsRoute = fs.readFileSync(
  path.join(repoRoot, "server", "routes", "patients.ts"),
  "utf8",
);
const lifecycleService = fs.readFileSync(
  path.join(repoRoot, "server", "services", "patient-animal-lifecycle.service.ts"),
  "utf8",
);
const cleanupScheduler = fs.readFileSync(
  path.join(repoRoot, "server", "lib", "cleanup-scheduler.ts"),
  "utf8",
);
const coreSchema = fs.readFileSync(path.join(repoRoot, "server", "schema", "core.ts"), "utf8");
const apiClient = fs.readFileSync(path.join(repoRoot, "src", "lib", "api.ts"), "utf8");

describe("Patient animal lifecycle — soft delete & retention", () => {
  it("animals schema includes deletedAt and deletedBy", () => {
    expect(coreSchema).toContain('deletedAt: timestamp("deleted_at"');
    expect(coreSchema).toContain('deletedBy: text("deleted_by")');
  });

  it("DELETE /api/patients/:id is registered", () => {
    expect(patientsRoute).toContain('router.delete("/:id"');
  });

  it("active patient list excludes soft-deleted animals", () => {
    expect(patientsRoute).toContain("isNull(animals.deletedAt)");
  });

  it("admit restores soft-deleted animals after animalId is resolved", () => {
    const postStart = patientsRoute.indexOf('router.post("/", requireEffectiveRole("technician")');
    const postEnd = patientsRoute.indexOf("res.status(201).json", postStart);
    const postBody = patientsRoute.slice(postStart, postEnd);
    const nameMatchIdx = postBody.indexOf("animalId = existing[0]");
    const restoreIdx = postBody.indexOf("restoreAnimalIfSoftDeleted");
    const hospInsertIdx = postBody.indexOf("await db.insert(hospitalizations)");
    expect(nameMatchIdx).toBeGreaterThan(-1);
    expect(restoreIdx).toBeGreaterThan(nameMatchIdx);
    expect(hospInsertIdx).toBeGreaterThan(restoreIdx);
  });

  it("purge uses 90-day retention constant", () => {
    expect(lifecycleService).toContain("PURGE_AFTER_DAYS");
    expect(lifecycleService).toContain("purgeSoftDeletedAnimals");
    expect(cleanupScheduler).toContain("purgeSoftDeletedAnimals");
  });

  it("frontend exposes patients.remove API", () => {
    expect(apiClient).toContain("remove:");
    expect(apiClient).toContain('method: "DELETE"');
  });

  it("PATCH assign uses req.authUser (not legacy req.user)", () => {
    const assignStart = patientsRoute.indexOf('router.patch("/:id/assign"');
    expect(assignStart).toBeGreaterThan(-1);
    const assignBlock = patientsRoute.slice(assignStart, assignStart + 600);
    expect(assignBlock).toContain("req.authUser!.id");
    expect(assignBlock).not.toMatch(/req\.user/);
  });

  it("assign route is registered before default export", () => {
    const assignIdx = patientsRoute.indexOf('router.patch("/:id/assign"');
    const exportIdx = patientsRoute.lastIndexOf("export default router");
    expect(assignIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeGreaterThan(assignIdx);
  });
});
