import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { ActionProposal } from "@/types/action-proposals";

interface HandoverDeltaEntry {
  sourceId: string;
  kind: string;
  targetId: string | null;
  targetType: string | null;
  at: string;
}

interface HandoverDraftContent {
  shiftSessionId: string;
  windowStart: string;
  windowEnd: string;
  deltas: {
    custody: HandoverDeltaEntry[];
    taskState: HandoverDeltaEntry[];
    alerts: HandoverDeltaEntry[];
    dispenses: HandoverDeltaEntry[];
  };
  openItems: { id: string; kind: string; summary: string }[];
  title: string;
}

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable C) — `shift_handover_draft` minimal
 * card. Reuses `t.handoverPage.*`'s existing delta-dimension labels (the
 * SAME `ShiftHandoverDeltas` shape as the live artifact page,
 * `handover-artifact-panel.tsx`) rather than duplicating new i18n keys for
 * an identical concept — but does NOT import that file's component code
 * (confirmed, per the plan's §2 review note, to have no reusable
 * sub-components).
 */
export function HandoverDraftCard({ proposal }: { proposal: ActionProposal }) {
  const content = proposal.draftContent as HandoverDraftContent;
  const counts: [string, number][] = [
    [t.handoverPage.deltaCustody, content.deltas.custody.length],
    [t.handoverPage.deltaTasks, content.deltas.taskState.length],
    [t.handoverPage.deltaAlerts, content.deltas.alerts.length],
    [t.handoverPage.deltaDispenses, content.deltas.dispenses.length],
  ];

  return (
    <div className="flex flex-col gap-3" data-testid="handover-draft-card">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map(([label, count]) => (
          <div key={label} className="rounded-lg border border-ivory-border bg-ivory-surface px-2 py-1.5 text-center">
            <div className="text-lg font-bold tabular-nums">{count}</div>
            <div className="text-xs text-ivory-text3">{label}</div>
          </div>
        ))}
      </div>
      <div>
        <p className="text-xs font-semibold text-ivory-text3">{t.handoverPage.openItemsHeading}</p>
        {content.openItems.length > 0 ? (
          <ul className="mt-1 flex flex-col gap-1">
            {content.openItems.map((item) => (
              <li key={item.id} className="text-sm">
                <Bdi>{item.summary}</Bdi>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ivory-text3">{t.handoverPage.openItemsNone}</p>
        )}
      </div>
    </div>
  );
}
