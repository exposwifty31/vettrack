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
  it("CommandBoardScreen renders CodeBlueOverlay when codeBlueSession is present", () => {
    // Phase 4 C1: the board UI + Phase-9 data path moved out of display.tsx into
    // the command-board module; the codeBlueSession→CodeBlueOverlay dispatch now
    // lives in CommandBoardScreen.
    const source = fs.readFileSync("src/features/command-board/CommandBoardScreen.tsx", "utf8");
    expect(source).toContain("CodeBlueOverlay");
    expect(source).toMatch(/snapshot\.codeBlueSession[\s\S]{0,80}CodeBlueOverlay/);
  });

  it("display route returns empty hospitalizations (patients surface removed)", () => {
    const source = fs.readFileSync("server/routes/display.ts", "utf8");
    expect(source).toContain("hospitalizations: []");
  });

  it("CodeBlueOverlay timer uses session.startedAt from server", () => {
    // CodeBlueOverlay is now its own presentational file; read it directly.
    const overlayBlock = fs.readFileSync(
      "src/features/command-board/components/CodeBlueOverlay.tsx",
      "utf8",
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
