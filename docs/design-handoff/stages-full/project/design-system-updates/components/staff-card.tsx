// Lands at: src/components/general/staff-card.tsx
// Design System Alignment — Phase 21 (review item 13, "Visual Ownership" —
// staff/technician cards). Composes two REAL, already-shipped primitives
// rather than inventing new avatar/color systems: getInitials
// (src/lib/user-utils.ts — already used by Topbar/ProfileHeroZone/
// NativeHeader) for the avatar, and RoleBadge (§20-D5, Phase 1) for the
// role pill. Genuinely new only in that it composes the two into one card.
import * as React from "react";
import { getInitials } from "@/lib/user-utils";
import { RoleBadge } from "@/components/ui/role-badge";
import type { RoleKind } from "@/core/entities/design-tokens";
import { cn } from "@/lib/utils";

export interface StaffCardProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  role: RoleKind;
  /** e.g. "On shift" / "Off shift" / "On break". Omit to hide the line. */
  shiftStatus?: string;
  /** Small dot on the avatar. Default true. */
  onShift?: boolean;
}

export function StaffCard({
  name,
  role,
  shiftStatus,
  onShift = true,
  className,
  ...props
}: StaffCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border bg-card p-3",
        className,
      )}
      {...props}
    >
      <div className="relative shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {getInitials(name)}
        </div>
        {onShift ? (
          <span
            className="absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card"
            style={{ background: "var(--status-ok-fg)" }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <RoleBadge role={role} className="mt-1" />
        {shiftStatus ? (
          <p className="mt-1 text-xs font-medium text-muted-foreground">{shiftStatus}</p>
        ) : null}
      </div>
    </div>
  );
}
