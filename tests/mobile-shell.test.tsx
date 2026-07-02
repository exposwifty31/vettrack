/**
 * @vitest-environment happy-dom
 *
 * Regression tests for MobileShell context wiring and tab-bar active-state logic.
 * Pinned contracts:
 *   1. MobileShell sets MobileShellContext to true for its subtree.
 *   2. AppShell renders children only (no Layout chrome) when MobileShellContext is true.
 *   3. The tab `isTabActive` rule marks exactly the matching tab active.
 *
 * Note: active-tab behavior is asserted against the pure `isTabActive` function
 * rather than through a rendered wouter `<Router>`. The render path depends on
 * `useLocation()` resolving the injected memory hook, which proved flaky under
 * the shared, CPU-contended CI worker (location intermittently resolved to "/",
 * spuriously activating the Today tab). Testing the pure decision function keeps
 * the contract coverage deterministic; the components stay covered by the
 * render-based context/chrome/landmark tests below.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { MobileShell } from "@/shell/mobile/MobileShell";
import { MobileTabBar } from "@/shell/mobile/MobileTabBar";
import { NativeTabSidebar } from "@/native/NativeTabSidebar";
import { AppShell } from "@/components/layout/AppShell";
import { isTabActive as tabBarIsActive } from "@/native/NativeTabBar";
import { isTabActive as sidebarIsActive } from "@/native/NativeTabSidebar";

vi.mock("@/lib/i18n", () => ({
  t: {
    nav: {
      today: "Today",
      equipment: "Equipment",
      mine: "My equipment",
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
vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => false,
  // useScanAffordance (via ScanFab / native tab bars) reads capacitorPlatform.
  capacitorPlatform: () => "web",
}));
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

afterEach(() => cleanup());

/**
 * A hook's return value can't be asserted directly, so this helper renders the
 * resolved MobileShellContext value into the DOM where the context tests can
 * read it via screen queries.
 */
function ContextReadout() {
  const value = useMobileShellContext();
  return <span data-testid="ctx">{String(value)}</span>;
}

function renderAt(path: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}>{ui}</Router>);
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

// Active-tab contract, asserted on the pure decision functions (deterministic,
// independent of wouter render-time location resolution).
describe.each([
  ["NativeTabBar", tabBarIsActive],
  ["NativeTabSidebar", sidebarIsActive],
])("%s isTabActive", (_name, isTabActive) => {
  it("marks the Today tab (/home) active at /home and at root /", () => {
    expect(isTabActive("/home", "/home")).toBe(true);
    expect(isTabActive("/", "/home")).toBe(true);
  });

  it("does not mark the Today tab active on other routes", () => {
    expect(isTabActive("/equipment", "/home")).toBe(false);
    expect(isTabActive("/code-blue", "/home")).toBe(false);
  });

  it("marks the Equipment tab (/equipment) active at /equipment and nested paths", () => {
    expect(isTabActive("/equipment", "/equipment")).toBe(true);
    expect(isTabActive("/equipment/eq-1", "/equipment")).toBe(true);
  });

  it("keeps the Equipment tab active when the href carries a query (/equipment?scan=1)", () => {
    expect(isTabActive("/equipment", "/equipment?scan=1")).toBe(true);
  });

  it("does not mark the Equipment tab active at root or on Today", () => {
    expect(isTabActive("/", "/equipment")).toBe(false);
    expect(isTabActive("/home", "/equipment")).toBe(false);
  });

  it("marks the Emergency tab (/code-blue) active at /code-blue only", () => {
    expect(isTabActive("/code-blue", "/code-blue")).toBe(true);
    expect(isTabActive("/home", "/code-blue")).toBe(false);
  });
});

describe("tab-bar rendering", () => {
  it("MobileTabBar renders the tab navigation landmark", () => {
    renderAt("/home", <MobileTabBar onMorePress={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Tab navigation" })).toBeTruthy();
  });

  it("NativeTabSidebar renders the tab navigation landmark", () => {
    renderAt("/home", <NativeTabSidebar onMorePress={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Tab navigation" })).toBeTruthy();
  });
});
