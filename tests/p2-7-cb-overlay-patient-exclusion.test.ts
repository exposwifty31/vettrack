/**
 * P2-7 regression: Ward display Code Blue overlay architecture.
 *
 * Patient/hospitalization lists were removed from the ward display snapshot
 * when the patients surface was retired. Code Blue now takes over the full
 * display via CodeBlueOverlay without filtering a remaining-patients list.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";

describe("P2-7: Ward display Code Blue overlay (current architecture)", () => {
  it("display.tsx renders CodeBlueOverlay when codeBlueSession is present", () => {
    const source = fs.readFileSync("src/pages/display.tsx", "utf8");
    expect(source).toContain("CodeBlueOverlay");
    expect(source).toMatch(/snapshot\.codeBlueSession[\s\S]{0,80}CodeBlueOverlay/);
  });

  it("display route returns empty hospitalizations (patients surface removed)", () => {
    const source = fs.readFileSync("server/routes/display.ts", "utf8");
    expect(source).toContain("hospitalizations: []");
  });

  it("CodeBlueOverlay timer uses session.startedAt from server", () => {
    const source = fs.readFileSync("src/pages/display.tsx", "utf8");
    const overlayBlock = source.slice(
      source.indexOf("function CodeBlueOverlay"),
      source.indexOf("export default function WardDisplayPage"),
    );
    expect(overlayBlock).toContain("session.startedAt");
    expect(overlayBlock).not.toMatch(/Date\.now\(\)\s*-\s*Date\.now/);
  });

  it("DisplaySnapshotHospitalization type remains for snapshot contract compat", () => {
    const source = fs.readFileSync("src/types/safety-surfaces.ts", "utf8");
    expect(source).toContain("export interface DisplaySnapshotHospitalization");
    expect(source).toContain("animalId?: string");
  });
});
