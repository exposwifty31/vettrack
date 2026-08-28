/**
 * @vitest-environment happy-dom
 *
 * S11.3 — WebOnlyGuard: the guard overlay sat below the shift-chat FAB (z-60)
 * and panel (z-65), so chat floated over a screen that exists to say "this
 * surface is unavailable here".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { readFileSync } from "fs";
import { resolve } from "path";

vi.mock("@/hooks/use-is-desktop", () => ({ useIsDesktop: () => false }));
vi.mock("@/lib/capacitor-runtime", () => ({
  isCapacitorNative: () => false,
  isCapacitorIOS: () => false,
  isCapacitorAndroid: () => false,
}));

afterEach(() => cleanup());

import { WebOnlyGuard } from "@/app/platform/guards/WebOnlyGuard";

/** Highest `z-[n]` literal in a source file, or null when it has none. */
function maxArbitraryZ(relPath: string): number | null {
  const src = readFileSync(resolve(process.cwd(), relPath), "utf8");
  const found = [...src.matchAll(/z-\[(\d+)\]/g)].map((m) => Number(m[1]));
  return found.length ? Math.max(...found) : null;
}

describe("S11.3 — the web-only guard stacks above the shift-chat launcher", () => {
  it("renders the guard screen above both the chat FAB and the chat panel", () => {
    render(
      <Router hook={memoryLocation({ path: "/analytics" }).hook}>
        <WebOnlyGuard>
          <div data-testid="gated-child" />
        </WebOnlyGuard>
      </Router>,
    );

    const guard = screen.getByTestId("web-only-guard-screen");
    expect(screen.queryByTestId("gated-child")).toBeNull();

    const zClass = Array.from(guard.classList).find((c) => /^z-/.test(c));
    expect(zClass).toBeTruthy();
    const guardZ = Number(/^z-\[?(\d+)\]?$/.exec(zClass!)?.[1]);
    expect(Number.isFinite(guardZ)).toBe(true);

    const fabZ = maxArbitraryZ("src/features/shift-chat/components/ShiftChatFab.tsx");
    const panelZ = maxArbitraryZ("src/features/shift-chat/components/ShiftChatPanel.tsx");
    expect(fabZ).not.toBeNull();
    expect(panelZ).not.toBeNull();
    expect(guardZ).toBeGreaterThan(fabZ!);
    expect(guardZ).toBeGreaterThan(panelZ!);
  });
});
