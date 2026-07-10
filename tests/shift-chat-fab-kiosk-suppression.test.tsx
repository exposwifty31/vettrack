/**
 * @vitest-environment happy-dom
 *
 * T5 audit fix (BUG 3) — the shift-chat floating launcher (ShiftChatFab, via
 * ShiftChatLauncher) must not render over kiosk/wall/emergency routes, e.g.
 * it was overlapping the /emergency-equipment-wall display. ShiftChatLauncher
 * now reuses isKioskSuppressedPathname (src/app/platform) — the same
 * predicate the PWA install promo uses — so the two suppression lists stay
 * in sync.
 *
 * useAuth and useShiftChat are mocked so this stays a focused unit test of
 * the launcher's route-gating logic, not an integration test of the chat
 * panel's data layer.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ role: "technician", effectiveRole: "technician" }),
}));

vi.mock("@/features/shift-chat/hooks/useShiftChat", () => ({
  useShiftChat: () => ({ unreadCount: 0 }),
}));

vi.mock("@/features/shift-chat/components/ShiftChatPanel", () => ({
  ShiftChatPanel: () => null,
}));

import { ShiftChatFab } from "@/features/shift-chat/components/ShiftChatFab";

function renderFab(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <ShiftChatFab />
    </Router>,
  );
}

afterEach(() => cleanup());

describe("ShiftChatFab — kiosk/wall/emergency suppression", () => {
  it.each([
    "/emergency-equipment-wall",
    "/code-blue/display",
    "/board",
    "/board/pair",
    "/crash-cart/session-1",
  ])("renders no launcher button on %s", (path) => {
    renderFab(path);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the launcher button on a non-kiosk route", () => {
    renderFab("/equipment");
    expect(screen.queryByRole("button")).toBeTruthy();
  });
});
