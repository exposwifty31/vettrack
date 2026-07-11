/**
 * @vitest-environment happy-dom
 *
 * T20 (frozen-surface audit fix, BLOCKING-adjacent) — the Code Blue wall
 * display (`/code-blue/display`, src/pages/code-blue-display.tsx) must be
 * driven by the frozen SSE transport, NOT by a bare ~2 s poll on
 * `/api/code-blue/sessions/active`. It reads the SSE-fed DISPLAY_SNAPSHOT
 * (which the event-reducer refetches on CODE_BLUE_STATUS_CHANGED) and mounts
 * the shared realtime client seam (EventIngestor + connectRealtime + replay +
 * reconciliation + keepalive), exactly like the canonical Command Center
 * board. Polling is demoted to the snapshot's bounded degraded fallback.
 *
 * This test locks two contracts non-vacuously:
 *   1. On mount the wall subscribes to the frozen SSE stream — connectRealtime
 *      is called WITH an EventIngestor (the primary update path), and the old
 *      bespoke CB-active poll is never issued.
 *   2. A Code Blue event propagates over that SSE path: an ingested
 *      CODE_BLUE_STATUS_CHANGED refetches the snapshot and the wall flips from
 *      standby to the active CODE BLUE surface — with no polling of the CB
 *      endpoint involved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import { EventIngestor } from "@/lib/realtime";
import type { DisplaySnapshot } from "@/types";
import type { RealtimeEvent } from "@/types/realtime-events";

// ── Snapshot fixtures (SSE-fed DISPLAY_SNAPSHOT) ─────────────────────────────
const baseSnapshot = {
  currentTime: new Date().toISOString(),
  currentShift: [],
  hospitalizations: [],
  equipment: [],
  upcomingTasks: [],
  overdueTasks: [],
  activeAlertCount: 0,
  totalOverdueCount: 0,
  crashCartStatus: null,
  codeBlueSession: null,
} satisfies DisplaySnapshot;

const STANDBY_SNAPSHOT: DisplaySnapshot = { ...baseSnapshot, codeBlueSession: null };

const ACTIVE_SNAPSHOT: DisplaySnapshot = {
  ...baseSnapshot,
  codeBlueSession: {
    id: "cb-session-1",
    startedAt: new Date().toISOString(),
    managerUserName: "Dr Cohen",
    preCheckPassed: true,
    pushSentAt: new Date().toISOString(),
    linkedEquipment: [{ id: "eq-1", name: "Defibrillator" }],
    logEntries: [
      { elapsedMs: 5_000, label: "CPR started", category: "note", loggedByName: "Nurse A" },
    ],
    presence: [{ userId: "u-1", userName: "Nurse A", lastSeenAt: new Date().toISOString() }],
  },
};

// Mutable snapshot the mocked API returns; flipped mid-test to simulate a
// server-side Code Blue start that propagates via an SSE event.
let snapshotValue: DisplaySnapshot = STANDBY_SNAPSHOT;

const snapshotMock = vi.fn(async () => snapshotValue);
const getActiveMock = vi.fn(async () => ({
  session: null,
  logEntries: [],
  presence: [],
  cartStatus: null,
  linkedEquipment: [],
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      display: { ...actual.api.display, snapshot: () => snapshotMock() },
      codeBlue: {
        ...actual.api.codeBlue,
        sessions: { ...actual.api.codeBlue.sessions, getActive: () => getActiveMock() },
      },
      realtime: {
        ...actual.api.realtime,
        telemetry: vi.fn(async () => ({})),
        replay: vi.fn(async () => ({ events: [], hasMore: false })),
        outboxHead: vi.fn(async () => ({ maxPublishedId: 0 })),
      },
    },
  };
});

// Spy connectRealtime so we can (a) prove the wall subscribes with an ingestor
// and (b) capture that ingestor to drive an event through the real ingest path
// — without opening a real EventSource in the test environment.
let capturedIngestor: EventIngestor | null = null;
const connectRealtimeSpy = vi.fn(
  (_onEvent: unknown, options?: { ingestor?: EventIngestor }) => {
    if (options?.ingestor) capturedIngestor = options.ingestor;
  },
);

vi.mock("@/lib/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/realtime")>();
  return {
    ...actual,
    connectRealtime: (...args: [unknown, { ingestor?: EventIngestor }?]) =>
      connectRealtimeSpy(...args),
  };
});

import CodeBlueDisplay from "@/pages/code-blue-display";

function renderWall() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeBlueDisplay />
    </QueryClientProvider>,
  );
}

describe("Code Blue wall display — driven by frozen SSE transport (T20)", () => {
  beforeEach(() => {
    snapshotValue = STANDBY_SNAPSHOT;
    capturedIngestor = null;
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });
  afterEach(() => cleanup());

  it("subscribes to the SSE stream with an EventIngestor (SSE-primary, no CB poll)", async () => {
    renderWall();

    // Standby renders from the SSE-fed snapshot (codeBlueSession = null).
    await screen.findByText(t.codeBlue.display.awaitingEvent);

    // Primary update path is the frozen SSE client: connectRealtime called
    // WITH an outbox-cursor EventIngestor.
    await waitFor(() => expect(connectRealtimeSpy).toHaveBeenCalled());
    expect(capturedIngestor).toBeInstanceOf(EventIngestor);

    // The demoted, bespoke CB-active poll is never the driver.
    expect(getActiveMock).not.toHaveBeenCalled();
  });

  it("propagates a Code Blue event over SSE: standby → active via ingested CODE_BLUE_STATUS_CHANGED", async () => {
    renderWall();
    await screen.findByText(t.codeBlue.display.awaitingEvent);
    await waitFor(() => expect(capturedIngestor).toBeInstanceOf(EventIngestor));

    // Server starts a Code Blue; the next snapshot fetch reflects it. The SSE
    // event is what triggers that refetch on the wall (event-reducer applyEvent).
    snapshotValue = ACTIVE_SNAPSHOT;
    const event: RealtimeEvent = {
      type: "CODE_BLUE_STATUS_CHANGED",
      payload: {},
      timestamp: new Date().toISOString(),
      id: 7,
      outboxId: 7,
      eventVersion: 1,
    };
    capturedIngestor!.ingest(event);

    // Wall flips to the active surface — driven by the SSE event, not a poll.
    await screen.findByText(/CODE BLUE ACTIVE/);
    expect(getActiveMock).not.toHaveBeenCalled();
  });
});
