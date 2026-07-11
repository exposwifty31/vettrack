/**
 * @vitest-environment happy-dom
 *
 * T22 — desktop chrome: (1) PageShell used to render BOTH the Topbar (text nav)
 * AND the IconSidebar (icon rail) driven by the exact same NAV + management-nav
 * models, so every destination appeared twice; only Topbar remains. (2) the
 * primary nav strip in Topbar overflows without wrapping at intermediate desktop
 * widths (~1227px) and used to show a raw scrollbar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

let caps = new Set<string>(["management.web", "app.adminNav"]);
vi.mock("@/hooks/use-experience", () => ({
  useExperience: () => ({ archetype: "admin", capabilities: caps, can: (c: string) => caps.has(c) }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ name: "Dana Cohen", activeShift: null, userId: "u-1" }),
}));
vi.mock("@/lib/api", () => ({
  api: {
    equipment: { list: vi.fn(async () => []) },
    alertAcks: { list: vi.fn(async () => []) },
    users: { me: vi.fn(async () => null) },
  },
}));

import { PageShell } from "@/components/layout/PageShell";

function renderShell(path = "/equipment") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <PageShell>
          <div>PAGE_BODY</div>
        </PageShell>
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  caps = new Set(["management.web", "app.adminNav"]);
});
afterEach(() => cleanup());

describe("PageShell — one canonical desktop nav, not a duplicated top-nav + icon rail", () => {
  it("renders each NAV destination exactly once (Topbar only — no IconSidebar rail)", () => {
    const { container } = renderShell();
    // Before the fix, IconSidebar duplicated every Topbar link as an icon —
    // /equipment and /alerts would each have 2 anchors instead of 1. (/home is
    // excluded: Topbar's own logo AND its "today" nav item both legitimately
    // link there, independent of any IconSidebar duplication.)
    expect(container.querySelectorAll('a[href="/equipment"]').length).toBe(1);
    expect(container.querySelectorAll('a[href="/alerts"]').length).toBe(1);
    expect(container.querySelectorAll('a[href="/code-blue"]').length).toBe(1);
  });

  it("does not render the icon-rail <aside> element at all", () => {
    const { container } = renderShell();
    // IconSidebar's root is an <aside>; PageShell no longer mounts it.
    expect(container.querySelector("aside")).toBeNull();
  });

  it("still renders the page content and the Topbar header landmark", () => {
    renderShell();
    expect(screen.getByText("PAGE_BODY")).toBeTruthy();
    expect(document.querySelector("header")).toBeTruthy();
  });
});

describe("PageShell source — the icon rail is retired from the render tree", () => {
  // Matches the JSX tag `<Sidebar` followed by whitespace, `>`, or `/` — NOT
  // `<SidebarDivider`, which is a distinct, still-legitimately-used component.
  const SIDEBAR_TAG = /<Sidebar[\s/>]/;

  it("PageShell.tsx no longer mounts <Sidebar>", () => {
    const src = read("src/components/layout/PageShell.tsx");
    expect(src).not.toMatch(SIDEBAR_TAG);
  });

  it("no other module renders <Sidebar> either (single removal point)", () => {
    const layoutDir = path.join(repoRoot, "src/components/layout");
    const offenders: string[] = [];
    for (const file of fs.readdirSync(layoutDir)) {
      if (file === "Sidebar.tsx" || !file.endsWith(".tsx")) continue;
      const src = fs.readFileSync(path.join(layoutDir, file), "utf8");
      if (SIDEBAR_TAG.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("Topbar — admin nav container has an overflow-safe layout (structural)", () => {
  // jsdom/happy-dom don't perform real layout, so the ~1227px raw-scrollbar
  // repro itself needs a Playwright follow-up. This asserts the CSS mechanism
  // that prevents it: a shrinkable (min-w-0) flex child that scrolls without
  // showing a native scrollbar, instead of a fixed-width strip that overflows
  // the header.
  const src = read("src/components/layout/Topbar.tsx");
  const navLine = src.split("\n").find((l) => l.includes("<nav ref={navRef}"));

  it("the primary nav strip exists and is horizontally scrollable", () => {
    expect(navLine, "expected the primary nav element").toBeTruthy();
    expect(navLine).toContain("overflow-x-auto");
  });

  it("hides the native scrollbar instead of showing a raw one", () => {
    expect(navLine).toContain("scrollbar-none");
  });

  it("is allowed to shrink within the flex row (min-w-0) instead of forcing overflow", () => {
    expect(navLine).toContain("min-w-0");
  });

  it("scrollbar-none is the same repo-wide utility used elsewhere (no new mechanism invented)", () => {
    const css = read("src/index.css");
    expect(css).toContain(".scrollbar-none");
  });
});
