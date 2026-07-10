import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useShiftChat } from "../hooks/useShiftChat";
import { ShiftChatPanel } from "./ShiftChatPanel";
import { useAuth } from "@/hooks/use-auth";
import { isKioskSuppressedPathname } from "@/app/platform";

type TriggerArgs = {
  /** Open the chat panel. */
  open: () => void;
  /** Unread message count (0 when none). */
  unreadCount: number;
};

type Props = {
  /** Renders the launch control (a FAB on phone/web, a header button on iPad). */
  renderTrigger: (args: TriggerArgs) => ReactNode;
};

/**
 * Owns the shift-chat launch state, the single `useShiftChat` subscription, and
 * the panel. The trigger is injected so the same wiring backs both the phone/web
 * floating button (`ShiftChatFab`) and the iPad header button (`NativeHeader`).
 * Exactly one launcher is mounted per device, so there is never a second
 * `useShiftChat` instance competing for unread state.
 */
export function ShiftChatLauncher({ renderTrigger }: Props) {
  const { role, effectiveRole } = useAuth();
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const chat = useShiftChat(isOpen);

  // Only render for shift-eligible roles
  const eligibleRoles = ["vet", "technician", "senior_technician", "admin"];
  if (!eligibleRoles.includes(effectiveRole ?? role ?? "")) return null;
  if (location === "/" || location === "/landing" || location.startsWith("/signin") || location.startsWith("/signup")) {
    return null;
  }
  // Kiosk/wall/emergency routes: shares the same predicate as the PWA install
  // promo (src/app/platform) so the two suppression lists can't drift apart.
  // Covers /board (headless kiosk, has its own header launcher story on
  // tablet — irrelevant here since /board never resolves the desktop/web
  // shell that mounts this launcher) and /emergency-equipment-wall, in
  // addition to /code-blue and /crash-cart already covered below.
  if (isKioskSuppressedPathname(location)) return null;
  // Focused fullscreen flows own the whole screen (and usually a bottom-anchored
  // primary action, e.g. Code Blue's "continue without full check"). The launcher
  // hides here so the float never overlaps that content — matching the header's
  // fullscreen behavior on iPad, where these routes hide the chat button too.
  const FULLSCREEN_ROUTES = ["/code-blue", "/crash-cart", "/scan", "/handoff"];
  if (FULLSCREEN_ROUTES.some((r) => location.startsWith(r))) return null;

  return (
    <>
      {/* Trigger hides while the panel is open — otherwise it floats over the
          panel's own close button in the same corner. */}
      {!isOpen && renderTrigger({ open: () => setIsOpen(true), unreadCount: chat.unreadCount })}

      <ShiftChatPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        chat={chat}
      />
    </>
  );
}
