import { Bdi } from "@/components/ui/bdi";
import { formatDateTime } from "@/lib/utils";
import { formatDateByLocale } from "@/lib/i18n";
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

  /**
   * The scan date is what makes one day's proposal distinct from the next —
   * `sourceSessionId = scanDate`, and `ux_vt_action_proposal_clinic_kind_session`
   * permits exactly one row per clinic per kind per day. It was absent from the
   * card, so a never-checked cart produced a stack of visually identical rows (its
   * summary and every other rendered field are constants). Shown on both drift
   * types so the whole card kind is anchored, not just the branch that broke.
   */
  // `scanDate` is date-only ("YYYY-MM-DD"); `new Date` would read it as UTC midnight
  // and render the previous calendar day in any negative-offset zone. Anchoring at
  // local noon is the same idiom `formatChartBucketDay` uses for yyyy-MM-dd buckets.
  const scanDateLine = (
    <p className="text-xs text-ivory-text3" data-testid="crash-cart-drift-scan-date">
      {k.scanDateLabel}: {formatDateByLocale(`${content.scanDate}T12:00:00`)}
    </p>
  );

  if (content.driftType === "missing_items") {
    return (
      <div className="flex flex-col gap-2" data-testid="crash-cart-drift-card">
        {scanDateLine}
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
      {scanDateLine}
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
