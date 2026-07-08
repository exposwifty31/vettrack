import { describe, it, expect } from "vitest";
import {
  mergeReaderRows,
  readerStatus,
  READER_ONLINE_WINDOW_MS,
  type ReaderRoomAssignment,
  type ReaderObservation,
} from "../shared/rfid-readers.js";

const NOW = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("readerStatus", () => {
  it("is no_signal when never seen or unparseable", () => {
    expect(readerStatus(null, NOW)).toBe("no_signal");
    expect(readerStatus("not-a-date", NOW)).toBe("no_signal");
  });

  it("is online within the window and stale beyond it", () => {
    expect(readerStatus(iso(NOW - 60_000), NOW)).toBe("online");
    expect(readerStatus(iso(NOW - READER_ONLINE_WINDOW_MS), NOW)).toBe("online"); // boundary inclusive
    expect(readerStatus(iso(NOW - READER_ONLINE_WINDOW_MS - 1), NOW)).toBe("stale");
  });
});

describe("mergeReaderRows", () => {
  it("joins room assignment with doorway heartbeat by gatewayCode", () => {
    const rooms: ReaderRoomAssignment[] = [{ gatewayCode: "GW-1", roomId: "room-1", roomName: "ICU" }];
    const obs: ReaderObservation[] = [
      { gatewayCode: "GW-1", lastSeenAt: iso(NOW - 60_000), observedEquipmentCount: 3 },
    ];
    const [row] = mergeReaderRows(rooms, obs, NOW);
    expect(row).toMatchObject({
      gatewayCode: "GW-1",
      roomId: "room-1",
      roomName: "ICU",
      observedEquipmentCount: 3,
      status: "online",
    });
  });

  it("keeps assigned-but-unseen readers as no_signal with zero count", () => {
    const rooms: ReaderRoomAssignment[] = [{ gatewayCode: "GW-2", roomId: "room-2", roomName: "Prep" }];
    const [row] = mergeReaderRows(rooms, [], NOW);
    expect(row).toMatchObject({ roomName: "Prep", lastSeenAt: null, observedEquipmentCount: 0, status: "no_signal" });
  });

  it("surfaces observed-but-unassigned gateways (no room)", () => {
    const obs: ReaderObservation[] = [
      { gatewayCode: "GW-3", lastSeenAt: iso(NOW - 10 * 60_000), observedEquipmentCount: 1 },
    ];
    const [row] = mergeReaderRows([], obs, NOW);
    expect(row).toMatchObject({ gatewayCode: "GW-3", roomId: null, roomName: null, status: "stale" });
  });

  it("sorts by gatewayCode for stable rendering", () => {
    const rooms: ReaderRoomAssignment[] = [
      { gatewayCode: "GW-9", roomId: "r9", roomName: "Z" },
      { gatewayCode: "GW-1", roomId: "r1", roomName: "A" },
    ];
    expect(mergeReaderRows(rooms, [], NOW).map((r) => r.gatewayCode)).toEqual(["GW-1", "GW-9"]);
  });
});
