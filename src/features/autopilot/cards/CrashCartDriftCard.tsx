import { Bdi } from "@/components/ui/bdi";
import { formatDateTime } from "@/lib/utils";
import { t } from "@/lib/i18n";
import type { ActionProposal } from "@/types/action-proposals";

interface CrashCartFailedItem {
  key: string;
  label: string;
  itemRowId: string;
}

interface CrashCartMissingItemsDraftContent {
  driftType: "missing_items";
  scanDate: string;
  lastCheckId: string;
  lastCheckPerformedAt: string;
  failedItems: CrashCartFailedItem[];
  title: string;
}

interface CrashCartStaleCheckDraftContent {
  driftType: "stale_check";
  scanDate: string;
  hasNeverBeenChecked: boolean;
  lastCheckPerformedAt: string | null;
  hoursSinceLastCheck: number | null;
  thresholdHours: number;
  title: string;
}

type CrashCartDriftDraftContent = CrashCartMissingItemsDraftContent | CrashCartStaleCheckDraftContent;

/** VetTrack 2.0, Task 1.1 §6 (deliverable C) — `crash_cart_drift` minimal card, driftType-specific. */
export function CrashCartDriftCard({ proposal }: { proposal: ActionProposal }) {
  const content = proposal.draftContent as CrashCartDriftDraftContent;
  const k = t.autopilotQueue.kinds.crashCartDrift;

  if (content.driftType === "missing_items") {
    return (
      <div className="flex flex-col gap-2" data-testid="crash-cart-drift-card">
        <p className="text-xs text-ivory-text3">
          {k.lastCheckedLabel}: {formatDateTime(content.lastCheckPerformedAt)}
        </p>
        <div>
          <p className="text-xs font-semibold text-ivory-text3">{k.failedItemsLabel}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {content.failedItems.map((item) => (
              <li key={item.key} className="text-sm">
                <Bdi>{item.label}</Bdi>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="crash-cart-drift-card">
      <p className="text-sm">
        {content.hasNeverBeenChecked ? (
          k.neverCheckedLabel
        ) : (
          <>
            {k.lastCheckedLabel}: {formatDateTime(content.lastCheckPerformedAt)}
          </>
        )}
      </p>
      {content.hoursSinceLastCheck != null && (
        <p className="text-xs text-ivory-text3">
          {k.hoursSinceLabel}: {content.hoursSinceLastCheck}
        </p>
      )}
      <p className="text-xs text-ivory-text3">
        {k.thresholdLabel}: {content.thresholdHours}
      </p>
    </div>
  );
}
