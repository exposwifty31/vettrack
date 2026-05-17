// Phase 9 PR 9.3 — verify TASK_* realtime events invalidate the Department
// Display snapshot query so the display surface reflects task status changes
// without waiting for the snapshot poll cadence.

import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// Mock the api module so applyEvent's TASK_* branches don't make HTTP calls
// (PATIENT_STATUS_UPDATED does fetch a snapshot — TASK_* just invalidate).
vi.mock("@/lib/api", () => ({
  api: {
    display: {
      snapshot: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/er-api", () => ({
  ER_MODE_QUERY_KEY: ["er", "mode"],
  getErAssignees: vi.fn().mockResolvedValue({}),
  getErBoard: vi.fn().mockResolvedValue({}),
  getErEligibleHospitalizations: vi.fn().mockResolvedValue({}),
  getErMode: vi.fn().mockResolvedValue({}),
}));

import { applyEvent, DISPLAY_SNAPSHOT_QUERY_KEY } from "../src/lib/event-reducer";
import type { RealtimeEvent } from "../src/types/realtime-events";

function makeEvent(type: RealtimeEvent["type"]): RealtimeEvent {
  return {
    type,
    payload: {},
    timestamp: "2026-05-17T12:00:00Z",
    id: 1,
  };
}

describe("event-reducer — TASK_* events invalidate display snapshot", () => {
  const TASK_EVENT_TYPES: RealtimeEvent["type"][] = [
    "TASK_CREATED",
    "TASK_STARTED",
    "TASK_COMPLETED",
    "TASK_APPROVED",
    "TASK_UPDATED",
    "TASK_CANCELLED",
  ];

  for (const type of TASK_EVENT_TYPES) {
    it(`invalidates DISPLAY_SNAPSHOT_QUERY_KEY on ${type}`, async () => {
      const client = new QueryClient();
      const spy = vi.spyOn(client, "invalidateQueries");
      await applyEvent(client, makeEvent(type));
      expect(spy).toHaveBeenCalledWith({ queryKey: DISPLAY_SNAPSHOT_QUERY_KEY });
    });
  }

  it("DISPLAY_SNAPSHOT_QUERY_KEY matches the hook's query key", () => {
    // The display snapshot hook uses ["/api/display/snapshot"]; the reducer
    // must use the same exact key or invalidation will silently no-op.
    expect(DISPLAY_SNAPSHOT_QUERY_KEY).toEqual(["/api/display/snapshot"]);
  });
});
