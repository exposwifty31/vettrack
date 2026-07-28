import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { ActionProposal } from "@/types/action-proposals";

interface RestockPoLineDraft {
  itemId: string;
  quantitySuggested: number;
}

interface RestockPoDraftContent {
  supplierName: string;
  scanDate: string;
  lines: RestockPoLineDraft[];
  title: string;
  suggestedQuantityLabel: string;
}

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable C) — `restock_po_on_burn` minimal
 * card. Note from the plan (§6, edit affordance): the "edit" button on
 * `ProposalCard` for this kind opens `RestockEditDialog`, the one
 * structured editor built for v1 — this component is read-only display.
 */
export function RestockPoCard({ proposal }: { proposal: ActionProposal }) {
  const content = proposal.draftContent as RestockPoDraftContent;
  const k = t.autopilotQueue.kinds.restockPoOnBurn;

  return (
    <div className="flex flex-col gap-2" data-testid="restock-po-card">
      <p className="text-sm">
        <span className="text-ivory-text3">{k.supplierLabel}: </span>
        <Bdi>{content.supplierName}</Bdi>
      </p>
      <div>
        <p className="text-xs font-semibold text-ivory-text3">{k.lineItemsLabel}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {content.lines.map((line) => (
            <li key={line.itemId} className="flex items-center justify-between gap-2 text-sm">
              <Bdi dir="ltr" className="min-w-0 truncate">
                {line.itemId}
              </Bdi>
              <span className="shrink-0 tabular-nums text-ivory-text3" title={content.suggestedQuantityLabel}>
                {line.quantitySuggested}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
