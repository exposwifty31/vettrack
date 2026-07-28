import { CheckCircle, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { t } from "@/lib/i18n";
import { useProposalQueue } from "./use-proposal-queue";
import { ProposalCard } from "./ProposalCard";
import { renderDraftContentForKind } from "./render-draft-content";
import { kindTitle } from "./kind-title";
import type { ActionProposal, ActionProposalKind } from "@/types/action-proposals";

const KIND_ORDER: ActionProposalKind[] = [
  "shift_handover_draft",
  "coordinator_reassign_off_roster",
  "restock_po_on_burn",
  "crash_cart_drift",
];

function groupByKind(proposals: ActionProposal[]): Array<[ActionProposalKind, ActionProposal[]]> {
  return KIND_ORDER.map((kind) => [kind, proposals.filter((p) => p.kind === kind)] as [ActionProposalKind, ActionProposal[]]).filter(
    ([, group]) => group.length > 0,
  );
}

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable A) — approval-queue container:
 * fetches staged proposals (§1.5(d) polling + collab-ws nudge via
 * `useProposalQueue`), groups by kind, and renders `ProposalCard`s inside
 * an `aria-live="polite"` region so a proposal that arrives while the
 * surface is open is announced — noise-discipline still applies (this is a
 * bounded queue list, not a firehose; the region only announces content
 * changes, never plays a sound or forces focus).
 */
export function ProposalQueueList() {
  const { data, isLoading, isError, refetch } = useProposalQueue({ status: "staged" });
  const proposals = data?.proposals ?? [];
  const groups = groupByKind(proposals);

  return (
    <div aria-live="polite" data-testid="proposal-queue-list">
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ivory-text3" role="status" aria-busy="true">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <span className="sr-only">{t.common.loading}</span>
        </div>
      ) : isError ? (
        <ErrorCard message={t.autopilotQueue.loadFailed} onRetry={refetch} />
      ) : proposals.length === 0 ? (
        <EmptyState icon={CheckCircle} message={t.autopilotQueue.empty} />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(([kind, group]) => (
            <div key={kind} className="flex flex-col gap-3">
              {groups.length > 1 && (
                <h2 className="text-xs font-bold uppercase tracking-wide text-ivory-text3">{kindTitle(kind)}</h2>
              )}
              {group.map((proposal) => (
                <ProposalCard key={proposal.id} proposal={proposal} renderDraftContent={renderDraftContentForKind} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
