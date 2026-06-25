/**
 * @vitest-environment happy-dom
 *
 * Regression tests for MobileShell context wiring and MobileTabBar active-tab
 * behavior. These pin three contracts:
 *   1. MobileShell sets MobileShellContext to true for its subtree.
 *   2. AppShell renders children only (no Layout chrome) when MobileShellContext is true.
 *   3. MobileTabBar marks the active tab with aria-current="page" based on location.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useContext } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MobileShellContext, useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { MobileShell } from "@/shell/mobile/MobileShell";
import { MobileTabBar } from "@/shell/mobile/MobileTabBar";
import { AppShell } from "@/components/layout/AppShell";

vi.mock("@/lib/i18n", () => ({
  t: {
    nav: {
      today: "Today",
      equipment: "Equipment",
      alerts: "Alerts",
      more: "More",
      equipmentScan: "Scan",
      tabBar: "Tab navigation",
    },
    common: { openNavigationMenu: "Open navigation menu" },
  },
}));

vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => false }));
vi.mock("@/lib/capacitor-runtime", () => ({ isCapacitorNative: () => false }));
vi.mock("@/components/layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));
vi.mock("@/components/layout/PageShell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="page-shell">{children}</div>
  ),
}));
vi.mock("@/lib/routes/nav-model", () => ({ NAV: [] }));

afterEach(() => cleanup());

function ContextReadout() {
  const value = useMobileShellContext();
  return <span data-testid="ctx">{String(value)}</span>;
}

describe("MobileShellContext", () => {
  it("defaults to false outside MobileShell", () => {
    render(<ContextReadout />);
    expect(screen.getByTestId("ctx").textContent).toBe("false");
  });

  it("is true inside MobileShell", () => {
    const { hook } = memoryLocation({ path: "/home" });
    render(
      <Router hook={hook}>
        <MobileShell>
          <ContextReadout />
        </MobileShell>
      </Router>,
    );
    expect(screen.getByTestId("ctx").textContent).toBe("true");
  });
});

describe("AppShell inside MobileShell", () => {
  it("renders children without Layout chrome when MobileShellContext is active", () => {
    const { hook } = memoryLocation({ path: "/home" });
    render(
      <Router hook={hook}>
        <MobileShell>
          <AppShell>
            <span data-testid="content">page content</span>
          </AppShell>
        </MobileShell>
      </Router>,
    );
    expect(screen.getByTestId("content")).toBeTruthy();
    expect(screen.queryByTestId("layout")).toBeNull();
  });

  it("renders Layout chrome outside MobileShell", () => {
    const { hook } = memoryLocation({ path: "/home" });
    render(
      <Router hook={hook}>
        <AppShell>
          <span data-testid="content">page content</span>
        </AppShell>
      </Router>,
    );
    expect(screen.getByTestId("content")).toBeTruthy();
    expect(screen.getByTestId("layout")).toBeTruthy();
  });
});

describe("MobileTabBar active state", () => {
  it("marks Today tab as active at /home", () => {
    const { hook } = memoryLocation({ path: "/home" });
    render(
      <Router hook={hook}>
        <MobileTabBar />
      </Router>,
    );
    const todayBtn = screen.getByText("Today").closest("button");
    expect(todayBtn?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("marks Equipment tab as active at /equipment", () => {
    const { hook } = memoryLocation({ path: "/equipment" });
    render(
      <Router hook={hook}>
        <MobileTabBar />
      </Router>,
    );
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Today").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("marks Alerts tab as active at /alerts", () => {
    const { hook } = memoryLocation({ path: "/alerts" });
    render(
      <Router hook={hook}>
        <MobileTabBar />
      </Router>,
    );
    expect(screen.getByText("Alerts").closest("button")?.getAttribute("aria-current")).toBe("page");
  });

  it("uses tab-bar-specific nav label", () => {
    const { hook } = memoryLocation({ path: "/home" });
    render(
      <Router hook={hook}>
        <MobileTabBar />
      </Router>,
    );
    expect(screen.getByRole("navigation", { name: "Tab navigation" })).toBeTruthy();
  });
});
