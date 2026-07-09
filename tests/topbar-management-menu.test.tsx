/**
 * @vitest-environment happy-dom
 *
 * M2 fix — the Topbar collapses the ~11 Phase 7 management links into a labeled
 * "Management" dropdown so they never overflow the horizontal nav strip. Covers:
 * empty → renders nothing, trigger opens/lists the links, active item is marked
 * aria-current, and selecting an item closes the menu.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { t } from "@/lib/i18n";
import { TopbarManagementMenu } from "@/components/layout/TopbarManagementMenu";

const navText = (key: string) => (t.nav as Record<string, string>)[key.slice(4)];

const ITEMS = [
  { id: "mgmt-integrations", href: "/admin/integrations", labelKey: "nav.integrations" },
  { id: "mgmt-people", href: "/admin/people", labelKey: "nav.people" },
  { id: "mgmt-audit", href: "/admin/audit-log", labelKey: "nav.auditLog" },
];

function renderMenu(activeHref = "") {
  const { hook } = memoryLocation({ path: "/admin/people" });
  return render(
    <Router hook={hook}>
      <TopbarManagementMenu items={ITEMS} activeHref={activeHref} />
    </Router>,
  );
}

afterEach(() => cleanup());

describe("TopbarManagementMenu", () => {
  it("renders nothing when there are no management items", () => {
    const { container } = render(
      <Router hook={memoryLocation({ path: "/" }).hook}>
        <TopbarManagementMenu items={[]} activeHref="" />
      </Router>,
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("opens the dropdown and lists every management link", () => {
    renderMenu();
    // Links hidden until opened.
    expect(screen.queryByText(navText("nav.integrations"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.nav.management) }));
    expect(screen.getByText(navText("nav.integrations"))).toBeTruthy();
    expect(screen.getByText(navText("nav.people"))).toBeTruthy();
    expect(screen.getByText(navText("nav.auditLog"))).toBeTruthy();
  });

  it("marks the active item with aria-current", () => {
    renderMenu("/admin/people");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.nav.management) }));
    const active = screen.getByRole("button", { name: navText("nav.people") });
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  it("closes the menu after a link is selected", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t.nav.management) }));
    fireEvent.click(screen.getByRole("button", { name: navText("nav.integrations") }));
    // Panel collapses — the other links are gone.
    expect(screen.queryByText(navText("nav.auditLog"))).toBeNull();
  });
});
