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
const routesMount = fs.readFileSync(
  path.join(repoRoot, "server", "app", "routes.ts"),
  "utf8",
);
const dbSchema = fs.readFileSync(path.join(repoRoot, "server", "db.ts"), "utf8");
const apiClient = fs.readFileSync(path.join(repoRoot, "src", "lib", "api.ts"), "utf8");
const appRoutes = fs.readFileSync(path.join(repoRoot, "src", "app", "routes.tsx"), "utf8");

describe("Active Patients — route registration & auth", () => {
  it("POST /api/patients is mounted in server routes", () => {
    expect(routesMount).toContain('"/api/patients"');
  });

  it("Route applies requireAuth on all requests", () => {
    expect(patientsRoute).toContain("requireAuth");
  });

  it("Route requires at least technician role", () => {
    expect(patientsRoute).toContain('requireEffectiveRole("technician")');
  });

  it("Frontend /patients route is registered in app routes", () => {
    expect(appRoutes).toContain('path="/patients"');
  });

  it("Frontend /patients/:id route is registered in app routes", () => {
    expect(appRoutes).toContain('path="/patients/:id"');
  });
});

describe("Active Patients — multi-tenancy isolation", () => {
  it("List query is clinic-scoped", () => {
    expect(patientsRoute).toContain("eq(hospitalizations.clinicId, clinicId)");
  });

  it("GET /:id is clinic-scoped (cannot fetch cross-clinic record)", () => {
    // Both hospitalization id AND clinicId must be in the where clause
    const getById = patientsRoute.match(/router\.get\("\/:id"[\s\S]*?}\);/m)?.[0] ?? "";
    expect(getById).toContain("eq(hospitalizations.clinicId, clinicId)");
  });

  it("PATCH /:id/status is clinic-scoped", () => {
    const patch = patientsRoute.match(/router\.patch\("\/:id\/status"[\s\S]*?}\);/m)?.[0] ?? "";
    expect(patch).toContain("eq(hospitalizations.clinicId, clinicId)");
  });

  it("PATCH /:id/discharge is clinic-scoped", () => {
    const patch = patientsRoute.match(/router\.patch\("\/:id\/discharge"[\s\S]*?}\);/m)?.[0] ?? "";
    expect(patch).toContain("eq(hospitalizations.clinicId, clinicId)");
  });

  it("PATCH /:id (edit) is clinic-scoped on both animal and hospitalization writes", () => {
    expect(patientsRoute).toContain('router.patch("/:id"');
    // Both update calls (animal + hospitalization) must restrict on clinicId
    expect(patientsRoute).toMatch(/tx\.update\(animals\)[\s\S]*?eq\(animals\.clinicId, clinicId\)/);
    expect(patientsRoute).toMatch(/tx\.update\(hospitalizations\)[\s\S]*?eq\(hospitalizations\.clinicId, clinicId\)/);
  });

  it("Admit (POST) verifies animal belongs to clinic before admitting", () => {
    expect(patientsRoute).toContain("ANIMAL_NOT_IN_CLINIC");
  });

  it("New animal created on admit inherits clinicId", () => {
    // db.insert(animals).values({ ..., clinicId, name: data.animalName! ... })
    expect(patientsRoute).toContain("db.insert(animals)");
    expect(patientsRoute).toContain("clinicId,");
    expect(patientsRoute).toContain("name: data.animalName");
  });
});

describe("Active Patients — error contract (phase 5 compliance)", () => {
  it("All errors return apiError shape (code + reason + message + requestId)", () => {
    const legacyShape = /res\.status\([^)]+\)\.json\(\{\s*error\s*:/m;
    expect(legacyShape.test(patientsRoute)).toBe(false);
  });

  it("Route uses resolveRequestId helper", () => {
    expect(patientsRoute).toContain("resolveRequestId(");
  });

  it("Validation errors return 400 with VALIDATION_ERROR code", () => {
    expect(patientsRoute).toContain('"VALIDATION_ERROR"');
  });

  it("Not-found returns 404 with NOT_FOUND code", () => {
    expect(patientsRoute).toContain('"NOT_FOUND"');
  });

  it("Internal errors return INTERNAL_ERROR code", () => {
    expect(patientsRoute).toContain('"INTERNAL_ERROR"');
  });
});

describe("Active Patients — schema & discharge safety", () => {
  it("hospitalizations table exists in db schema", () => {
    expect(dbSchema).toContain("hospitalizations");
  });

  it("vt_hospitalizations table name in db schema", () => {
    expect(dbSchema).toContain("vt_hospitalizations");
  });

  it("admitSchema validates animalId OR animalName (not both required)", () => {
    expect(patientsRoute).toContain(
      '"Either animalId or animalName is required"',
    );
  });

  it("Discharge sets dischargedAt AND status=discharged atomically", () => {
    // Use a larger window since the discharge handler now includes pre-flight checks
    const start = patientsRoute.indexOf('router.patch("/:id/discharge"');
    const dischargeBlock = start >= 0 ? patientsRoute.slice(start, start + 6000) : "";
    expect(dischargeBlock).toContain('status: "discharged"');
    expect(dischargeBlock).toContain("dischargedAt: now");
  });

  it("Status update and discharge both guard against already-discharged records", () => {
    // Both patches filter isNull(hospitalizations.dischargedAt)
    const statusStart = patientsRoute.indexOf('router.patch("/:id/status"');
    const statusBlock = statusStart >= 0 ? patientsRoute.slice(statusStart, statusStart + 2000) : "";
    const dischargeStart = patientsRoute.indexOf('router.patch("/:id/discharge"');
    const dischargeBlock = dischargeStart >= 0 ? patientsRoute.slice(dischargeStart, dischargeStart + 6000) : "";
    expect(statusBlock).toContain("isNull(hospitalizations.dischargedAt)");
    expect(dischargeBlock).toContain("isNull(hospitalizations.dischargedAt)");
  });
});

describe("Active Patients — API client", () => {
  it("api.patients.list is defined", () => {
    expect(apiClient).toContain("patients");
    expect(apiClient).toContain("/api/patients");
  });

  it("api.patients.admit (POST) is defined", () => {
    // POST to /api/patients
    expect(apiClient).toMatch(/method:\s*["']POST["'][\s\S]{0,200}\/api\/patients|\/api\/patients[\s\S]{0,200}method:\s*["']POST["']/m);
  });

  it("api.patients.discharge is defined", () => {
    expect(apiClient).toContain("discharge");
  });

  it("api.patients.update is defined and PATCHes /api/patients/:id", () => {
    expect(apiClient).toMatch(/update:\s*\(id:\s*string[\s\S]*?\/api\/patients\/\$\{encodeURIComponent\(id\)\}[\s\S]*?method:\s*"PATCH"/m);
  });
});

describe("Active Patients — PATCH /:id edit endpoint", () => {
  function editBlock() {
    const start = patientsRoute.indexOf('router.patch("/:id"');
    const end = patientsRoute.indexOf('router.patch("/:id/status"', start);
    return start >= 0 && end > start ? patientsRoute.slice(start, end) : "";
  }

  it("rejects status=discharged (must use /:id/discharge)", () => {
    expect(patientsRoute).toContain("USE_DISCHARGE_ENDPOINT");
  });

  it("requires at least one editable field", () => {
    expect(patientsRoute).toContain("NO_FIELDS_TO_UPDATE");
  });

  it("guards against already-discharged records", () => {
    expect(editBlock()).toContain("isNull(hospitalizations.dischargedAt)");
  });

  it("writes animal + hospitalization updates inside a transaction", () => {
    expect(patientsRoute).toMatch(/db\.transaction\(async\s*\(tx\)\s*=>\s*\{[\s\S]*?tx\.update\(animals\)[\s\S]*?tx\.update\(hospitalizations\)/m);
  });

  it("emits patient_updated audit entry", () => {
    expect(patientsRoute).toContain('actionType: "patient_updated"');
  });

  it("animal and hospitalization updates are independently conditional (omitted fields preserved)", () => {
    // Both updates are wrapped in `if (Object.keys(...).length > 0)` so a
    // request that only touches animal fields does not write the hospitalization,
    // and vice versa.
    const block = editBlock();
    expect(block).toMatch(/if\s*\(Object\.keys\(animalUpdate\)\.length\s*>\s*0\)\s*\{[\s\S]*?tx\.update\(animals\)/m);
    expect(block).toMatch(/if\s*\(Object\.keys\(hospUpdate\)\.length\s*>\s*0\)\s*\{[\s\S]*?tx\.update\(hospitalizations\)/m);
  });

  it("each editable field is gated on `!== undefined` so omitted keys are preserved", () => {
    const block = editBlock();
    // Animal-side fields
    for (const field of ["animalName", "species", "breed", "sex", "weightKg"]) {
      expect(block).toContain(`if (data.${field} !== undefined)`);
    }
    // Hospitalization-side fields
    for (const field of ["ward", "bay", "admissionReason", "status"]) {
      expect(block).toContain(`if (data.${field} !== undefined)`);
    }
  });

  it("updateSchema marks every field as optional so partial PATCH is supported", () => {
    const schemaStart = patientsRoute.indexOf("const updateSchema");
    const schemaEnd = patientsRoute.indexOf("});", schemaStart);
    const schema = schemaStart >= 0 && schemaEnd > schemaStart ? patientsRoute.slice(schemaStart, schemaEnd) : "";
    for (const field of ["animalName", "species", "breed", "sex", "weightKg", "ward", "bay", "admissionReason", "status"]) {
      // each must appear with .optional() somewhere in its declaration
      const fieldLine = schema.split("\n").find((l) => l.includes(`${field}:`));
      expect(fieldLine ?? "", `${field} declaration`).toMatch(/\.optional\(\)/);
    }
  });
});
