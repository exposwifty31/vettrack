import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-browser";
import { getCurrentUserId } from "@/lib/auth-store";
import { reportNudgeShown } from "@/lib/realtime";
import type { Nudge } from "@/types/nudges";

const DISMISSED_NUDGES_STORAGE_KEY = "vt_dismissed_nudge_ids";

// Scoped per signed-in user — otherwise one staff member dismissing a nudge
// on a shared tablet would hide it for the next person too, since the raw
// key is shared across every user of that browser profile.
function dismissedIdsStorageKey(): string {
  return `${DISMISSED_NUDGES_STORAGE_KEY}:${getCurrentUserId()}`;
}

function readDismissedIds(): Set<string> {
  const raw = safeStorageGetItem(dismissedIdsStorageKey());
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function persistDismissedIds(ids: Set<string>): void {
  safeStorageSetItem(dismissedIdsStorageKey(), JSON.stringify(Array.from(ids)));
}

/**
 * Localizes the glance-only copy by `kind`. `Nudge["kind"]` is currently the
 * closed union `"expiry"` (src/types/nudges.ts), but the server's telemetry
 * enum (server/routes/realtime.ts ALLOWED_NUDGE_SHOWN) already reserves
 * "restock" for a future nudge source — widen to `string` here so this stays
 * forward-compatible without a type error once that kind ships.
 */
function nudgeMessage(nudge: Nudge): string {
  if (nudge.message) return nudge.message;
  const kind: string = nudge.kind;
  if (kind === "restock") return t.homeNudges.restockMessage;
  return t.homeNudges.expiryMessage;
}

/**
 * Dismissible, glance-only nudge feed for the home surfaces (T-30b · R-IN-F1 ·
 * small-03). Fetches the current user's role-scoped feed via the existing
 * GET /api/nudges query (api.nudges.list) — no new realtime/poll path.
 *
 * Dismiss is purely client-side: the dismissed nudge id is stored in
 * localStorage (survives reloads) and is never sent to the server — nudges
 * are compute-on-read (server/services/nudge-feed.service.ts), not stateful
 * rows, so there is nothing server-side to acknowledge.
 */
export function HomeNudges() {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedIds());
  const reportedShownIds = useRef<Set<string>>(new Set());

  const { data, isError, error } = useQuery({
    queryKey: ["/api/nudges"],
    queryFn: api.nudges.list,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      // Nudges are glance-only and non-critical — degrade to rendering
      // nothing (same as a genuinely empty feed), but log so a broken
      // /api/nudges route doesn't silently look identical to "no nudges".
      console.error("[HomeNudges] failed to load nudge feed", error);
    }
  }, [isError, error]);

  const visible = useMemo(
    () => (data?.nudges ?? []).filter((nudge) => !dismissedIds.has(nudge.id)),
    [data, dismissedIds],
  );

  useEffect(() => {
    for (const nudge of visible) {
      if (!reportedShownIds.current.has(nudge.id)) {
        reportedShownIds.current.add(nudge.id);
        reportNudgeShown(nudge.kind);
      }
    }
  }, [visible]);

  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistDismissedIds(next);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="home-nudges">
      {visible.map((nudge) => (
        <output
          key={nudge.id}
          data-testid={`home-nudge-${nudge.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-medium"
          style={{ background: "#fffbeb", borderColor: "#fde68a", color: "#78350f" }}
        >
          <span className="min-w-0 flex-1">{nudgeMessage(nudge)}</span>
          <button
            type="button"
            onClick={() => dismiss(nudge.id)}
            aria-label={t.homeNudges.dismissAria}
            data-testid={`home-nudge-dismiss-${nudge.id}`}
            data-no-touch-min
            className="shrink-0 rounded-md p-1 opacity-70 transition hover:opacity-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </output>
      ))}
    </div>
  );
}
