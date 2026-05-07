import { useState } from "react";
import { cn } from "@/lib/utils";
import { useShiftChat } from "../hooks/useShiftChat";
import { ShiftChatPanel } from "./ShiftChatPanel";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export function ShiftChatFab() {
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

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "fixed bottom-nav-float right-5 z-[60]",
          "w-12 h-12 rounded-full",
          "bg-gradient-to-br from-indigo-600 to-violet-700",
          "flex items-center justify-center text-xl shadow-lg shadow-indigo-500/40",
          "transition-transform hover:scale-105 active:scale-95",
        )}
        aria-label="פתח צ'אט משמרת"
      >
        💬
        {chat.unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-background">
            {chat.unreadCount > 9 ? "9+" : chat.unreadCount}
          </span>
        )}
      </button>

      <ShiftChatPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        chat={chat}
      />
    </>
  );
}
