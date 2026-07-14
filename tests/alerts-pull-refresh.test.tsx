/**
 * @vitest-environment happy-dom
 *
 * T-50 (CLICK-PATH-032) — the pull-to-refresh handler set `refreshing` true,
 * called `refetch()` WITHOUT awaiting it, and cleared `refreshing` in the
 * `finally` on the same tick. So the `!refreshing` guard was defeated: a second
 * pull while the refetch was still in flight re-fired it. Fix: the controller's
 * `refetch` returns `Promise.all([...])` and the screen awaits it, so
 * `refreshing` stays true until the refetch resolves.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("wouter", () => ({ useLocation: () => ["/alerts", vi.fn()] }));
vi.mock("@/components/alerts/AlertsProView", () => ({
  AlertsProView: () => <div data-testid="pro-view" />,
}));

const refetch = vi.fn(() => new Promise<void>(() => {})); // never resolves: stays "in flight"
vi.mock("@/features/alerts/hooks/use-alerts-controller", () => ({
  formatRelativeDuration: () => "",
  useAlertsController: () => ({
    alerts: [],
    acksMap: {},
    equipmentLocationMap: {},
    canOwnAlerts: false,
    hasAckError: false,
    hasFatalError: false,
    isLoading: false,
    refetch,
    ack: vi.fn(),
    unAck: vi.fn(),
  }),
}));

import { AlertsScreen } from "@/features/alerts/AlertsScreen";

async function pull(root: Element) {
  fireEvent.touchStart(root, { touches: [{ clientY: 0 }] });
  fireEvent.touchMove(root, { touches: [{ clientY: 100 }] }); // delta 100 ≥ 72 threshold
  await act(async () => {
    fireEvent.touchEnd(root);
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AlertsScreen — pull-to-refresh in-flight guard (T-50)", () => {
  it("does not re-fire refetch while a pull-refresh is still in flight", async () => {
    const { container } = render(<AlertsScreen />);
    const root = container.firstElementChild as Element;

    await pull(root); // first pull → refetch fires, refreshing stays true (awaited)
    await pull(root); // second pull while in flight → must be blocked by the guard

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
