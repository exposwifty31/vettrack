/**
 * @vitest-environment happy-dom
 *
 * Regression tests for MobileShell context wiring and MobileTabBar active-tab
 * behavior. These pin three contracts:
 *   1. MobileShell sets MobileShellContext to true for its subtree.
 *   2. AppShell renders children only (no Layout chrome) when MobileShellContext is true.
 *   3. MobileTabBar marks the active tab with aria-current="page" based on location.
 *
 * Isolation note: the tab components read wouter's location. We drive them with
 * an in-memory `memoryLocation` hook, but under the shared happy-dom worker the
 * browser URL (`window.location`) can otherwise be left at "/" by a prior test,
 * which makes the Today tab (active on "/") spuriously win and the Equipment tab
 * resolve to inactive. `renderAt()` pins BOTH the injected hook and the document
 * URL to the test's path, and `afterEach` resets the URL so this file neither
 * leaks nor inherits location state.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useContext } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { MobileShellContext, useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { MobileShell } from "@/shell/mobile/MobileShell";
import { MobileTabBar } from "@/shell/mobile/MobileTabBar";
import { NativeTabSidebar } from "@/native/NativeTabSidebar";
import { AppShell } from "@/components/layout/AppShell";

vi.mock("@/lib/i18n", () => ({
  t: {
    nav: {
      today: "Today",
      equipment: "Equipment",
      emergency: "Emergency",
      menu: "Menu",
      equipmentScan: "Scan",
      tabBar: "Tab navigation",
    },
    common: { openNavigationMenu: "Open navigation menu" },
  },
  getStoredLocale: () => "he",
}));

vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => false }));
vi.mock("@/lib/capacitor-runtime", () => ({ isCapacitorNative: () => false }));
vi.mock("@/components/nfc-foreground-scan", () => ({ NfcForegroundScan: () => null }));
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
vi.mock("@/native/NativeHeader", () => ({ NativeHeader: () => null }));

afterEach(() => {
  cleanup();
  // Reset the document URL so location state never leaks between tests/files.
  window.history.replaceState(null, "", "/");
});

/**
 * Render `ui` at `path`, pinning both the wouter memory hook and the document
 * URL so the active-tab assertions are deterministic regardless of test order.
 */
function renderAt(path: string, ui: React.ReactElement) {
  window.history.replaceState(null, "", path);
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}</Router>);
}

/** Renders the current MobileShellContext value as text for assertions. */
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
    renderAt(
      "/home",
      <MobileShell>
        <ContextReadout />
      </MobileShell>,
    );
    expect(screen.getByTestId("ctx").textContent).toBe("true");
  });
});

describe("AppShell inside MobileShell", () => {
  it("renders children without Layout chrome when MobileShellContext is active", () => {
    renderAt(
      "/home",
      <MobileShell>
        <AppShell>
          <span data-testid="content">page content</span>
        </AppShell>
      </MobileShell>,
    );
    expect(screen.getByTestId("content")).toBeTruthy();
    expect(screen.queryByTestId("layout")).toBeNull();
  });

  it("renders PageShell chrome outside MobileShell", () => {
    renderAt(
      "/home",
      <AppShell>
        <span data-testid="content">page content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("content")).toBeTruthy();
    expect(screen.getByTestId("page-shell")).toBeTruthy();
  });
});

describe("MobileTabBar active state", () => {
  it("marks Today tab as active at /home", () => {
    renderAt("/home", <MobileTabBar onMorePress={() => {}} />);
    const todayBtn = screen.getByText("Today").closest("button");
    expect(todayBtn?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("marks Equipment tab as active at /equipment", () => {
    renderAt("/equipment", <MobileTabBar onMorePress={() => {}} />);
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Today").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("marks Emergency tab as active at /code-blue", () => {
    renderAt("/code-blue", <MobileTabBar onMorePress={() => {}} />);
    expect(screen.getByText("Emergency").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Today").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("marks Today tab as active at root /", () => {
    renderAt("/", <MobileTabBar onMorePress={() => {}} />);
    expect(screen.getByText("Today").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("keeps Equipment tab active at /equipment?scan=1", () => {
    renderAt("/equipment?scan=1", <MobileTabBar onMorePress={() => {}} />);
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Today").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("uses tab-bar-specific nav label", () => {
    renderAt("/home", <MobileTabBar onMorePress={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Tab navigation" })).toBeTruthy();
  });
});

describe("NativeTabSidebar active state", () => {
  it("marks Today tab as active at /home", () => {
    renderAt("/home", <NativeTabSidebar onMorePress={() => {}} />);
    const todayBtn = screen.getByText("Today").closest("button");
    expect(todayBtn?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("marks Today tab as active at root /", () => {
    renderAt("/", <NativeTabSidebar onMorePress={() => {}} />);
    expect(screen.getByText("Today").closest("button")?.getAttribute("aria-current")).toBe("page");
  });

  it("marks Equipment tab as active at /equipment?scan=1", () => {
    renderAt("/equipment?scan=1", <NativeTabSidebar onMorePress={() => {}} />);
    expect(screen.getByText("Equipment").closest("button")?.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Today").closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("renders sidebar navigation landmark", () => {
    renderAt("/home", <NativeTabSidebar onMorePress={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Tab navigation" })).toBeTruthy();
  });
});
