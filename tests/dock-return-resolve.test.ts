import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("dock-return master tag resolution (F10/NFC)", () => {
  const src = readFileSync(join(process.cwd(), "server/lib/dock-return-resolve.ts"), "utf8");

  it("resolves room by masterNfcTagId with clinicId filter", () => {
    expect(src).toContain("eq(rooms.masterNfcTagId, masterTag)");
    expect(src).toContain("eq(rooms.clinicId, clinicId)");
  });

  it("rejects ambiguous multi-dock rooms", () => {
    expect(src).toContain("ambiguous_docks");
    expect(src).toContain("dockRows.length > 1");
  });
});
