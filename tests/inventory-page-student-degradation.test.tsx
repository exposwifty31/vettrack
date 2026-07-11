/**
 * @vitest-environment happy-dom
 *
 * T16 — /inventory must not blank into a fatal "load failed" state for the
 * custody-only (student) archetype when GET /api/containers 403s.
 *
 * Root cause: GET /api/containers is `requireEffectiveRole("technician")`
 * (server/routes/containers.ts). A plain student (ROLE_HIERARCHY level 10)
 * never clears the technician floor (level 20), so the request genuinely
 * 403s — that authorization boundary is correct and untouched here. The bug
 * was that the page rendered that 403 with the SAME fatal `ErrorCard` used
 * for a real network/server failure, and because every other section of the
 * page (tab strip, take-consumables button, container detail card) derives
 * from `containersQ.data`, the student saw nothing but a scary "load failed"
 * card with no way forward.
 *
 * The fix uses the existing capability model (`isCustodyOnly`, driven by
 * `useExperience()` — no `role === "student"` literal in the page) to treat
 * a 403 on this specific fetch as an expected, non-fatal restricted state
 * for that archetype only. Every other role, and every non-403 failure,
 * keeps the original fatal ErrorCard behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import type { InventoryContainer, RestockContainerView } from "@/types";

interface MockAuth {
  userId: string | null;
  role: string;
  effectiveRole: string;
  roleSource: "shift" | "permanent";
  isAdmin: boolean;
}

let mockAuth: MockAuth;
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mockAuth }));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const listMock = vi.fn();
const bootstrapMock = vi.fn();
const containerItemsMock = vi.fn();
const startMock = vi.fn();
const scanMock = vi.fn();
const finishMock = vi.fn();

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    requestId?: string;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    api: {
      containers: {
        list: (...a: unknown[]) => listMock(...a),
        bootstrapDefaults: (...a: unknown[]) => bootstrapMock(...a),
      },
      restock: {
        containerItems: (...a: unknown[]) => containerItemsMock(...a),
        start: (...a: unknown[]) => startMock(...a),
        scan: (...a: unknown[]) => scanMock(...a),
        finish: (...a: unknown[]) => finishMock(...a),
      },
    },
  };
});

// Imported AFTER the mocks above so the component resolves the mocked modules.
import InventoryPage from "@/pages/inventory-page";
import { ApiError } from "@/lib/api";

const CONTAINER: InventoryContainer = {
  id: "c1",
  clinicId: "clinic-1",
  name: "ICU Cart",
  department: "hospital",
  targetQuantity: 10,
  currentQuantity: 8,
  roomId: null,
  billingItemId: null,
  nfcTagId: null,
};

const CONTAINER_VIEW: RestockContainerView = {
  container: CONTAINER,
  activeSession: null,
  lines: [
    { itemId: "i1", code: "SKU1", label: "Saline", expected: 10, actual: 8, missing: 2, sessionObservedQuantity: null, nfcTagId: null },
  ],
} as unknown as RestockContainerView;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/inventory" });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <Router hook={hook}>
          <InventoryPage />
        </Router>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  listMock.mockReset();
  bootstrapMock.mockReset();
  containerItemsMock.mockReset();
  startMock.mockReset();
  scanMock.mockReset();
  finishMock.mockReset();
  mockAuth = {
    userId: "u1",
    role: "student",
    effectiveRole: "student",
    roleSource: "permanent",
    isAdmin: false,
  };
});
afterEach(() => cleanup());

describe("InventoryPage — student (custody-only) graceful degradation", () => {
  it("renders a restricted empty state, NOT the fatal load-failed card, when GET /api/containers 403s", async () => {
    listMock.mockRejectedValue(new ApiError(403, "Insufficient permissions", {}));
    renderPage();

    // Restricted, non-alarming state renders.
    expect(await screen.findByText(t.inventoryPage.restrictedAccessTitle)).toBeTruthy();

    // The fatal, retry-oriented error card never renders for this 403.
    expect(screen.queryByText(t.inventoryPage.loadError)).toBeNull();

    // Core page chrome (header) still renders — the page isn't blank.
    expect(screen.getByText(t.inventoryPage.title)).toBeTruthy();
  });

  it("still shows the fatal error state for a student when the failure is NOT a 403 (no over-suppression)", async () => {
    listMock.mockRejectedValue(new ApiError(500, "boom", {}));
    renderPage();

    expect(await screen.findByText(t.inventoryPage.loadError)).toBeTruthy();
    expect(screen.queryByText(t.inventoryPage.restrictedAccessTitle)).toBeNull();
  });
});

describe("InventoryPage — non-student roles are unaffected", () => {
  it("a technician still sees the full page (containers + take-consumables) when the fetch succeeds", async () => {
    mockAuth = {
      userId: "u2",
      role: "technician",
      effectiveRole: "technician",
      roleSource: "permanent",
      isAdmin: false,
    };
    listMock.mockResolvedValue([CONTAINER]);
    containerItemsMock.mockResolvedValue(CONTAINER_VIEW);
    renderPage();

    expect((await screen.findAllByText("ICU Cart")).length).toBeGreaterThan(0);
    expect(screen.getByText(t.inventoryPage.takeConsumables)).toBeTruthy();
    expect(screen.queryByText(t.inventoryPage.loadError)).toBeNull();
    expect(screen.queryByText(t.inventoryPage.restrictedAccessTitle)).toBeNull();
  });

  it("a technician still sees the fatal load-failed card on a genuine 403 (role-gated section stays fatal for a role that is NOT custody-only)", async () => {
    mockAuth = {
      userId: "u3",
      role: "technician",
      effectiveRole: "technician",
      roleSource: "permanent",
      isAdmin: false,
    };
    listMock.mockRejectedValue(new ApiError(403, "Insufficient permissions", {}));
    renderPage();

    expect(await screen.findByText(t.inventoryPage.loadError)).toBeTruthy();
    expect(screen.queryByText(t.inventoryPage.restrictedAccessTitle)).toBeNull();
  });
});
