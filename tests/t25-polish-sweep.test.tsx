/**
 * @vitest-environment happy-dom
 *
 * T25 — LOW polish sweep (2026-07-10 QA audit). One focused test per
 * substantive fix; purely-visual items assert the structural fix instead of
 * pixels.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HelmetProvider } from "react-helmet-async";
import { t } from "@/lib/i18n";

afterEach(() => cleanup());

// ── Item 1: rooms master-detail empty state uses the room noun, not "item" ──

import { SelectItemPlaceholder } from "@/native/tablet/SelectItemPlaceholder";

describe("T25.1 — rooms empty-state noun", () => {
  it("RoomsMasterDetail's placeholder copy says 'select a room', not the generic 'select an item'", () => {
    render(
      <SelectItemPlaceholder
        title={t.roomsListPage.selectRoomTitle}
        subtitle={t.roomsListPage.selectRoomSubtitle}
      />,
    );
    expect(screen.getByText(t.roomsListPage.selectRoomTitle)).toBeTruthy();
    expect(screen.queryByText(t.common.selectItemTitle)).toBeNull();
  });

  it("RoomsMasterDetail.tsx actually wires the room-specific copy into the placeholder", async () => {
    vi.doMock("@/pages/rooms-list", () => ({ default: () => <div data-testid="stub-rooms-list" /> }));
    vi.doMock("@/pages/room-radar", () => ({ default: () => <div data-testid="stub-room-radar" /> }));
    const { default: RoomsMasterDetail } = await import("@/native/tablet/RoomsMasterDetail");
    const { hook } = memoryLocation({ path: "/rooms" });
    render(
      <Router hook={hook}>
        <RoomsMasterDetail />
      </Router>,
    );
    expect(screen.getByText(t.roomsListPage.selectRoomTitle)).toBeTruthy();
    expect(screen.queryByText(t.common.selectItemTitle)).toBeNull();
    vi.doUnmock("@/pages/rooms-list");
    vi.doUnmock("@/pages/room-radar");
  });
});

// ── Item 2: transfer activity shows a real fallback label, not a bare em-dash ──

import { EquipmentDetailActivityTab } from "@/components/equipment/EquipmentDetailActivityTab";
import type { TransferLog } from "@/types";

describe("T25.2 — transfer source fallback label", () => {
  it("renders the unfiled label, not a bare em-dash, when fromFolderName/toFolderName are absent", () => {
    const transfer: TransferLog = {
      id: "t1",
      equipmentId: "e1",
      fromFolderName: null,
      toFolderName: null,
      userId: "u1",
      timestamp: "2026-07-10T10:00:00.000Z",
    };
    render(
      <EquipmentDetailActivityTab
        scanLogs={[]}
        transfers={[transfer]}
        logsLoading={false}
        transfersLoading={false}
        hasOlderLogs={false}
        isFetchingOlderLogs={false}
        onLoadOlder={() => {}}
      />,
    );
    const row = screen.getByTestId("equipment-activity-timeline");
    expect(row.textContent).toContain(t.common.unfiled);
    expect(row.textContent).not.toContain("—");
  });

  it("still shows the real folder name when one side of the transfer has it", () => {
    const transfer: TransferLog = {
      id: "t2",
      equipmentId: "e1",
      fromFolderName: "Glucometers",
      toFolderName: null,
      userId: "u1",
      timestamp: "2026-07-10T10:00:00.000Z",
    };
    render(
      <EquipmentDetailActivityTab
        scanLogs={[]}
        transfers={[transfer]}
        logsLoading={false}
        transfersLoading={false}
        hasOlderLogs={false}
        isFetchingOlderLogs={false}
        onLoadOlder={() => {}}
      />,
    );
    const row = screen.getByTestId("equipment-activity-timeline");
    expect(row.textContent).toContain("Glucometers");
    expect(row.textContent).toContain(t.common.unfiled);
  });
});

// ── Item 3: iPad "at a glance" tiles clamp to 2 lines instead of cutting a
//    short value off mid-word, and bidi-isolate values that may be LTR ──

import { EquipmentGlanceGrid } from "@/features/equipment/detail/EquipmentGlanceGrid";
import type { Equipment } from "@/types";
import type { LocationInference } from "@/features/equipment/detail/hooks/use-equipment-detail";

function equipmentFixture(overrides: Partial<Equipment> = {}): Equipment {
  return {
    id: "eq1",
    name: "Defibrillator",
    status: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("T25.3 — iPad detail-pane tile truncation", () => {
  it("the assignee tile renders as a bidi-isolated, multi-line-clamped element (not single-line nowrap ellipsis)", () => {
    render(<EquipmentGlanceGrid equipment={equipmentFixture()} inference={null} />);
    const tile = screen.getByTestId("glance-tile-who");
    const valueEl = tile.querySelector("bdi");
    expect(valueEl).not.toBeNull();
    expect(valueEl?.textContent).toBe(t.equipmentDetail.unassigned);
    // Single-line ellipsis truncation (the old, awkward behavior) is gone —
    // the element clamps across 2 lines via -webkit-line-clamp instead.
    expect(valueEl?.className).not.toContain("truncate");
  });

  it("an LTR value (checked-out-by email) still renders inside the RTL grid without throwing", () => {
    render(
      <EquipmentGlanceGrid
        equipment={equipmentFixture({ checkedOutByEmail: "dr.claude@vettrackclinic.com" })}
        inference={null}
      />,
    );
    const tile = screen.getByTestId("glance-tile-who");
    expect(tile.textContent).toContain("dr.claude@vettrackclinic.com");
  });

  it("regression: a long mixed-direction value in the narrow RTL layout still gets a 2-line clamp + bdi isolation, not single-line truncation", () => {
    // Mixed Hebrew/English, long enough to wrap in a narrow iPad split-view
    // tile — this would fail if the tile ever regresses to single-line
    // `truncate` or drops the `as="bdi"` isolation.
    const mixedValue = "ד״ר Claude — Room 12B (ICU North Wing Overflow Bay)";
    const inference: LocationInference = {
      inferredLocation: null,
      confidence: "high",
      signalSource: "checkout",
      accountablePerson: { userId: "u1", name: mixedValue, currentRoom: null },
      lastConfirmedAt: null,
      reasoning: "checkout",
    };
    render(
      <div dir="rtl" style={{ width: 180 }}>
        <EquipmentGlanceGrid equipment={equipmentFixture()} inference={inference} />
      </div>,
    );
    const tile = screen.getByTestId("glance-tile-who");
    const valueEl = tile.querySelector("bdi");
    expect(valueEl).not.toBeNull();
    expect(valueEl?.textContent).toBe(mixedValue);
    // as="bdi": the rendered element is a native <bdi>, not a <span>/<div>.
    expect(valueEl?.tagName).toBe("BDI");
    // lines={2}: multi-line clamp styling (webkit-line-clamp), never the
    // single-line `truncate` class.
    expect(valueEl?.className).not.toContain("truncate");
    expect(valueEl?.className).toContain("overflow-hidden");
    expect((valueEl as HTMLElement).style.WebkitLineClamp).toBe("2");
  });
});

// ── Item 4: board coverage ring shows an explicit empty state at 0/0, not an
//    alarm-looking "0 / 0 · 0%" ──

import { CommandBoard } from "@/features/command-board/components/CommandBoard";
import type { EquipmentCommandBoardSnapshot } from "@/types/safety-surfaces";

function boardFixture(overrides: Partial<EquipmentCommandBoardSnapshot> = {}): EquipmentCommandBoardSnapshot {
  return {
    generatedAt: "2026-07-10T00:00:00.000Z",
    clinicId: "c1",
    overview: {
      totalCritical: 0,
      ready: 0,
      inUse: 0,
      blocked: 0,
      stale: 0,
      overdue: 0,
      unknown: 0,
      belowThresholdTypes: 0,
      activeEmergencyUnits: 0,
    },
    byType: [],
    byLocation: [],
    criticalUnits: [],
    alerts: [],
    roiSignals: {
      overusedUnits: [],
      underusedUnits: [],
      repairReplaceCandidates: [],
      typeShortages: [],
      duplicatePurchaseRisks: [],
    },
    ...overrides,
  };
}

function renderBoard(b: EquipmentCommandBoardSnapshot) {
  const { hook } = memoryLocation({ path: "/board" });
  return render(
    <Router hook={hook}>
      <CommandBoard board={b} currentTime="2026-07-10T00:00:00.000Z" currentShift={[]} />
    </Router>,
  );
}

describe("T25.4 — board empty ring (0/0 critical)", () => {
  it("shows the explicit 'no critical equipment configured' state instead of a 0/0 ring", () => {
    renderBoard(boardFixture());
    expect(screen.getByTestId("board-ring-no-critical")).toBeTruthy();
    expect(screen.getByText(t.board.noCriticalConfigured)).toBeTruthy();
    // The old numeric ring (deployable-now numeral + "of N" copy) must not render.
    expect(screen.queryByText(t.board.deployableNow)).toBeNull();
  });

  it("renders the normal numeric ring once critical equipment exists", () => {
    renderBoard(boardFixture({ overview: { ...boardFixture().overview, totalCritical: 4, ready: 3 } }));
    expect(screen.queryByTestId("board-ring-no-critical")).toBeNull();
    expect(screen.getByText(t.board.deployableNow)).toBeTruthy();
  });
});

// ── Item 5: coverage-card labels distinguish "checked out" from "in use" ──

import { CoverageCard } from "@/features/today/surfaces/ops/CoverageCard";

describe("T25.5 — coverage-tile ambiguous labels", () => {
  it("the itemsOut label is no longer a near-duplicate of the inUse label", () => {
    render(
      <CoverageCard
        availabilityPct={80}
        ready={8}
        notReady={2}
        itemsOut={3}
        inUse={5}
        isLoading={false}
      />,
    );
    expect(t.home.shift.itemsOut).not.toBe(t.homeSurface.inUse);
    expect(screen.getByText(t.home.shift.itemsOut)).toBeTruthy();
    expect(screen.getByText(t.homeSurface.inUse)).toBeTruthy();
  });
});

// ── Item 6: alert "in progress" chip composes a natural duration, not
//    "since ... ago" doubled up ──

import { formatRelativeDuration } from "@/features/alerts";

describe("T25.6 — awkward copy: alert in-progress duration composition", () => {
  it("formatRelativeDuration omits the locale 'ago' marker so the composed chip doesn't double up the temporal wording", () => {
    const elevenDaysAgo = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
    const duration = formatRelativeDuration(elevenDaysAgo);
    expect(duration).toBe(t.alertsPage.daysDuration(11));
    const composed = `${t.alertsPage.inProgressSince} ${duration}`;

    // Derive the locale's "ago" marker from the real translations (never a
    // hand-typed Hebrew literal) — the old bug reused `formatRelativeTime`,
    // which appends this marker, doubling up with `inProgressSince`'s own
    // "since"/"in progress" framing.
    const agoMarker = t.alertsPage.daysAgo(11).replace(t.alertsPage.daysDuration(11), "").trim();
    expect(agoMarker.length).toBeGreaterThan(0);
    expect(composed).not.toContain(agoMarker);
  });
});

// ── Item 8: re-entering /code-blue with an active session never shows the
//    launch form — a pending session check shows a loading state instead ──

const authState = { userId: "u-vet-1", role: "vet", name: "Dr. Vet" };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => authState }));
vi.mock("@/lib/haptics", () => ({ haptics: { error: vi.fn(), tap: vi.fn() } }));
vi.mock("@/lib/sounds", () => ({ playCriticalAlertTone: vi.fn().mockResolvedValue(undefined) }));

const codeBlueSessionState: {
  session: { id: string; status: "active" | "ended"; startedAt: string; managerUserId: string; managerUserName: string } | null;
  isLoading: boolean;
} = { session: null, isLoading: false };

vi.mock("@/hooks/useCodeBlueSession", () => ({
  useCodeBlueSession: () => ({
    session: codeBlueSessionState.session,
    refetch: vi.fn(),
    logEntries: [],
    presence: [],
    cartStatus: null,
    linkedEquipment: [],
    isLoading: codeBlueSessionState.isLoading,
    isError: false,
    logEntry: vi.fn(),
  }),
  clearCodeBlueSessionCache: vi.fn(),
}));

describe("T25.8 — Code Blue re-entry routes to the active view, never the launch form", () => {
  afterEach(() => {
    codeBlueSessionState.session = null;
    codeBlueSessionState.isLoading = false;
  });

  it("while the active-session check is pending, shows a loading state — not the launch form", async () => {
    codeBlueSessionState.isLoading = true;
    codeBlueSessionState.session = null;
    const { default: CodeBluePage } = await import("@/pages/code-blue");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CodeBluePage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("code-blue-loading")).toBeTruthy();
    expect(screen.queryByTestId("code-blue-start")).toBeNull();
  });

  it("once the check resolves with an ACTIVE session, renders the live view — not the launch form", async () => {
    codeBlueSessionState.isLoading = false;
    codeBlueSessionState.session = {
      id: "s1",
      status: "active",
      startedAt: new Date().toISOString(),
      managerUserId: "u-vet-1",
      managerUserName: "Dr. Vet",
    };
    const { default: CodeBluePage } = await import("@/pages/code-blue");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CodeBluePage />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("code-blue-start")).toBeNull();
    expect(screen.queryByTestId("code-blue-loading")).toBeNull();
    expect(screen.getByTestId("code-blue-leave")).toBeTruthy();
  });

  it("once the check resolves with NO session, falls through to the launch form as before", async () => {
    codeBlueSessionState.isLoading = false;
    codeBlueSessionState.session = null;
    const { default: CodeBluePage } = await import("@/pages/code-blue");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CodeBluePage />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("code-blue-start")).toBeTruthy();
  });
});

// ── Item 9: what's-new sources the version + build tag from the canonical
//    build-time constants, never a hand-maintained literal ──

import { getBundledAppVersion } from "@/lib/app-version";

describe("T25.9 — what's-new version is sourced from the canonical build tag", () => {
  it("getBundledAppVersion reflects the module-level __APP_VERSION__ constant", () => {
    expect(getBundledAppVersion()).toBe(typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0");
  });

  it("the WhatsNewPage version badge + build label render whatever the canonical helper returns, never a hand-maintained literal", async () => {
    vi.doMock("@capacitor/app", () => ({ App: { getInfo: vi.fn() } }));
    // Mock the canonical build-info source itself rather than asserting
    // against a specific "known-stale" string — proves the page is wired to
    // read live from the helper, for any value it returns.
    vi.doMock("@/lib/app-version", async () => {
      const actual = await vi.importActual<typeof import("@/lib/app-version")>("@/lib/app-version");
      return {
        ...actual,
        getBundledAppVersion: () => "9.9.9-mock",
        getBuildTagSuffix: () => "mockbuild9",
      };
    });
    const { default: WhatsNewPage } = await import("@/pages/whats-new");
    const { hook } = memoryLocation({ path: "/whats-new" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <HelmetProvider>
        <QueryClientProvider client={client}>
          <Router hook={hook}>
            <WhatsNewPage />
          </Router>
        </QueryClientProvider>
      </HelmetProvider>,
    );
    expect(screen.getByText("v9.9.9-mock")).toBeTruthy();
    expect(screen.getByText(t.whatsNew.buildLabel("mockbuild9"), { exact: false })).toBeTruthy();
    vi.doUnmock("@capacitor/app");
    vi.doUnmock("@/lib/app-version");
  });
});
