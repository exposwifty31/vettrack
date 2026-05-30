/**
 * dock-return-resolve — unit tests with mocked Drizzle db.
 *
 * Covers master NFC tag → dock resolution and ambiguous multi-dock rooms (#393 NFC).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

vi.mock("../server/db.js", () => ({
  db: { select: selectMock },
  docks: { id: "id", clinicId: "clinic_id", roomId: "room_id", name: "name" },
  rooms: { id: "id", clinicId: "clinic_id", masterNfcTagId: "master_nfc_tag_id" },
}));

import { resolveDockIdForReturn } from "../server/lib/dock-return-resolve.js";

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

function makeSelectChainNoLimit(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

describe("resolveDockIdForReturn", () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it("resolves explicit dockId when dock exists in clinic", async () => {
    selectMock.mockReturnValueOnce(makeSelectChain([{ id: "dock-1" }]));

    const result = await resolveDockIdForReturn("clinic-a", { dockId: "dock-1" });

    expect(result).toEqual({ ok: true, dockId: "dock-1", via: "dock_id" });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when explicit dockId is missing", async () => {
    selectMock.mockReturnValueOnce(makeSelectChain([]));

    const result = await resolveDockIdForReturn("clinic-a", { dockId: "missing" });

    expect(result).toEqual({ ok: false, status: 404, reason: "dock_not_found" });
  });

  it("returns 422 when neither dockId nor masterNfcTagId is provided", async () => {
    const result = await resolveDockIdForReturn("clinic-a", {});

    expect(result).toEqual({ ok: false, status: 422, reason: "dock_not_found" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns 404 when master tag does not match any room", async () => {
    selectMock.mockReturnValueOnce(makeSelectChain([]));

    const result = await resolveDockIdForReturn("clinic-a", { masterNfcTagId: "tag-unknown" });

    expect(result).toEqual({ ok: false, status: 404, reason: "room_not_found" });
  });

  it("returns 422 when room has no docks", async () => {
    selectMock
      .mockReturnValueOnce(makeSelectChain([{ id: "room-1" }]))
      .mockReturnValueOnce(makeSelectChainNoLimit([]));

    const result = await resolveDockIdForReturn("clinic-a", { masterNfcTagId: "master-1" });

    expect(result).toEqual({ ok: false, status: 422, reason: "no_dock_in_room" });
  });

  it("returns ambiguous_docks with dock list when room has multiple docks", async () => {
    selectMock
      .mockReturnValueOnce(makeSelectChain([{ id: "room-1" }]))
      .mockReturnValueOnce(
        makeSelectChainNoLimit([
          { id: "dock-a", name: "Dock A" },
          { id: "dock-b", name: "Dock B" },
        ]),
      );

    const result = await resolveDockIdForReturn("clinic-a", { masterNfcTagId: "master-1" });

    expect(result).toEqual({
      ok: false,
      status: 422,
      reason: "ambiguous_docks",
      docks: [
        { id: "dock-a", name: "Dock A" },
        { id: "dock-b", name: "Dock B" },
      ],
    });
  });

  it("resolves single dock via master NFC tag", async () => {
    selectMock
      .mockReturnValueOnce(makeSelectChain([{ id: "room-1" }]))
      .mockReturnValueOnce(makeSelectChainNoLimit([{ id: "dock-only", name: "Charging" }]));

    const result = await resolveDockIdForReturn("clinic-a", { masterNfcTagId: "  master-1  " });

    expect(result).toEqual({ ok: true, dockId: "dock-only", via: "master_nfc_tag" });
  });
});
