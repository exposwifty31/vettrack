import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { ShiftChatLauncher } from "./ShiftChatLauncher";

/**
 * Floating chat launcher for the phone + web shells. On the native tablet the
 * chat lives in the header (`NativeHeader`) instead, so this FAB is not mounted
 * there (see `GlobalShiftChat` in main.tsx) — keeping a single chat owner per
 * device.
 */
export function ShiftChatFab() {
  return (
    <ShiftChatLauncher
      renderTrigger={({ open, unreadCount }) => (
        <button
          type="button"
          onClick={open}
          className={cn(
            "fixed bottom-nav-float end-5 z-[60]",
            "w-12 h-12 rounded-full",
            "bg-gradient-to-br from-[var(--brand)] to-[var(--brand-deep)]",
            "flex items-center justify-center text-xl shadow-lg shadow-[var(--brand-shadow)]",
            "transition-transform hover:scale-105 motion-safe:active:scale-95",
          )}
          aria-label={
            unreadCount > 0
              ? t.shiftChat.openChatUnread(unreadCount > 9 ? "9+" : String(unreadCount))
              : t.shiftChat.openChat
          }
        >
          <span aria-hidden="true">💬</span>
          {unreadCount > 0 && (
            <span aria-hidden="true" className="absolute -top-1 -end-1 bg-red-700 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-background">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      )}
    />
  );
}
