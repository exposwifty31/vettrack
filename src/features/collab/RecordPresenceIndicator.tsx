import { Users } from "lucide-react";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { RecordPresenceMember } from "./useRecordPresence";

interface RecordPresenceIndicatorProps {
  /** Peers currently editing the record (advisory). Empty → renders nothing. */
  editors: RecordPresenceMember[];
}

/**
 * R-RTC-1.4 · Feature 3 — STRICTLY ADVISORY co-presence indicator.
 *
 * Renders "<name> is editing this" while a peer is editing the record. It is
 * purely informational: no interactive control, no gate — it NEVER blocks or
 * alters the edit. The server OCC/version guard remains the sole conflict
 * authority. With no peer editors (degraded or nobody editing) it renders
 * nothing, so the record detail behaves EXACTLY as today.
 */
export function RecordPresenceIndicator({ editors }: RecordPresenceIndicatorProps) {
  if (editors.length === 0) return null;

  const first = editors[0]!;
  const name = first.displayName.trim();
  const label = name ? t.recordCollab.editingThis(name) : t.recordCollab.someoneEditing;

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <Bdi>{label}</Bdi>
    </div>
  );
}
