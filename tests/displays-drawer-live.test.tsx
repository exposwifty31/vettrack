/**
 * @vitest-environment happy-dom
 *
 * T-53 (CLICK-PATH-035) — the manage drawer rendered from `managing`, a device
 * snapshot captured when the row was clicked, while the list keeps polling live.
 * So if a poll changed the device (e.g. it got revoked) the open drawer kept
 * acting on the stale snapshot. Fix: derive the drawer's device from live
 * `devicesQ.data` by id.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { t } from "@/lib/i18n";
import React from "react";

vi.mock("@/hooks/use-experience", () => ({ useExperience: () => ({ can: () => true }) }));
vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const listMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    display: {
      devices: {
        list: (...a: unknown[]) => listMock(...a),
        rename: vi.fn(),
        revoke: vi.fn(),
        delete: vi.fn(),
      },
      pairIssue: vi.fn(),
    },
  },
}));

import DisplaysConsolePage from "@/pages/console/DisplaysConsolePage";

const DEVICES_KEY = ["/api/display/devices"];
const activeDevice = {
  id: "d1",
  name: "Display 1",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DisplaysConsolePage — manage drawer reflects live device (T-53)", () => {
  it("updates the open drawer when a poll revokes the device", async () => {
    listMock.mockResolvedValue([activeDevice]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DisplaysConsolePage />
      </QueryClientProvider>,
    );

    // Row renders → open the manage drawer.
    await waitFor(() => expect(screen.getByText("Display 1")).toBeTruthy());
    fireEvent.click(screen.getByText("Display 1"));
    // Drawer is open: its rename input carries the device name.
    expect(screen.getByDisplayValue("Display 1")).toBeTruthy();

    // A background poll marks the device revoked.
    act(() => {
      qc.setQueryData(DEVICES_KEY, [{ ...activeDevice, revokedAt: "2026-02-01T00:00:00.000Z" }]);
    });

    // The drawer must follow live data → the "active" status is gone everywhere.
    await waitFor(() => expect(screen.queryByText(t.console.displays.statusActive)).toBeNull());
  });
});
