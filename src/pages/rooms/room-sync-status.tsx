import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { STALE_THRESHOLD_MS } from "@/lib/attention";
import { t } from "@/lib/i18n";
import type { Room } from "@/types";

/**
 * Room sync-status presentation, shared by the `/rooms` card grid and the desktop
 * `RoomsTable`. Extracted from `rooms-list.tsx` so the table can reuse it without
 * importing the page (which imports the table — a cycle `architecture:cycles` fails).
 */
export function SyncBadge({ status }: { status: string }) {
  if (status === "synced") {
    return (
      <div className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-[var(--status-ok-fg)] bg-[var(--status-ok-bg)] border border-[var(--status-ok-border)] rounded-full px-2 py-0.5 shrink-0">
        <CheckCircle2 className="w-2.5 h-2.5" />
        {t.roomsListPage.badgeSynced}
      </div>
    );
  }
  if (status === "requires_audit") {
    return (
      <div className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-[var(--status-issue-fg)] bg-[var(--status-issue-bg)] border border-[var(--status-issue-border)] rounded-full px-2 py-0.5 shrink-0">
        <AlertTriangle className="w-2.5 h-2.5" />
        {t.roomsListPage.badgeAudit}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-[10px] font-bold tracking-wide text-[var(--status-stale-fg)] bg-[var(--status-stale-bg)] border border-[var(--status-stale-border)] rounded-full px-2 py-0.5 shrink-0">
      <Clock className="w-2.5 h-2.5" />
      {t.roomsListPage.badgeStale}
    </div>
  );
}

/** `requires_audit` wins outright; otherwise an audit older than 24h reads as stale. */
export function computeEffectiveStatus(room: Room): string {
  if (room.syncStatus === "requires_audit") return "requires_audit";
  const auditAge = room.lastAuditAt ? Date.now() - new Date(room.lastAuditAt).getTime() : Infinity;
  if (auditAge > STALE_THRESHOLD_MS) return "stale";
  return room.syncStatus;
}
