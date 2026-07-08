/**
 * Product-archaeology critical fix (2026-07-08) — Tasks page must not link to
 * the removed patient domain.
 *
 * Migrations 142–143 removed patients/ER/meds (docs/scope-change-2026.md);
 * `/patients/:id` survives only as a redirect to /equipment. The Tasks page's
 * `PatientChartLink` kept promising a patient chart from six task cards and
 * dumped the user on the equipment list. The fix removes the link (the
 * `animalId` field is free-text, half-repurposed as a device label — a UUID
 * there may be a dead animal id, so repointing it anywhere is speculation).
 *
 * Static source contracts (house phase-7-dead-end-fixes style).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

describe("Tasks page carries no dead /patients promise", () => {
  const tasks = read("src/pages/Tasks.tsx");

  it("has no /patients hrefs", () => {
    expect(tasks).not.toContain("/patients");
  });

  it("PatientChartLink is gone entirely", () => {
    expect(tasks).not.toContain("PatientChartLink");
  });

  it("the repurposed device label still renders", () => {
    expect(tasks).toContain("formatDevice(");
    expect(tasks).toContain("t.appointmentsPage.linkedDevice");
  });
});

describe("the legacy redirect safety net stays (scope-change doctrine)", () => {
  it("routes.tsx still redirects /patients and /patients/:id to /equipment", () => {
    const routes = read("src/app/routes.tsx");
    expect(routes).toContain('<Route path="/patients"><Redirect to="/equipment" replace /></Route>');
    expect(routes).toContain('<Route path="/patients/:id"><Redirect to="/equipment" replace /></Route>');
  });
});
