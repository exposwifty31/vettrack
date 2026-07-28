import { type ReactNode, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bdi } from "@/components/ui/bdi";
import { formatDateTime } from "@/lib/utils";
import { AutopilotModeBadge } from "@/components/autopilot-mode-badge";
import { api } from "@/lib/api";
import { toastError, toastSuccess } from "@/lib/ui-toast";
import { t } from "@/lib/i18n";
import { PROPOSAL_QUEUE_QUERY_ROOT_KEY } from "./proposal-queue-keys";
import { RejectReasonDialog } from "./RejectReasonDialog";
import { RestockEditDialog, type RestockEditedContent, type RestockEditDraftContent } from "./RestockEditDialog";
import { EditUnavailableDialog } from "./EditUnavailableDialog";
import { kindTitle } from "./kind-title";
import type { ActionProposal } from "@/types/action-proposals";

export interface ProposalCardProps {
  proposal: ActionProposal;
  renderDraftContent: (proposal: ActionProposal) => ReactNode;
}

type PendingAction = "approve" | "edit" | "reject" | null;

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable B) — presentational shell: kind
 * title, summary, expandable citation-grounded "why", approve/edit/reject
 * action row, shadow-vs-enforce badge, `renderDraftContent` slot (compound-
 * component pattern per the repo's web coding-style rules).
 *
 * Server-confirmed updates only: no optimistic status flip on any action —
 * the card re-renders from the invalidated queue query on success; failure
 * surfaces a loud toast and leaves the proposal exactly as it was (the
 * user's own action row stays available to retry).
 */
export function ProposalCard({ proposal, renderDraftContent }: ProposalCardProps) {
  const queryClient = useQueryClient();
  const [showCitations, setShowCitations] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);

  function invalidateQueue(): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: [PROPOSAL_QUEUE_QUERY_ROOT_KEY] });
  }

  async function handleApprove(): Promise<void> {
    setPending("approve");
    try {
      await api.actionProposals.approve(proposal.id);
      toastSuccess(t.autopilotQueue.approveSuccess);
      await invalidateQueue();
    } catch {
      toastError(t.autopilotQueue.approveError);
    } finally {
      setPending(null);
    }
  }

  async function handleReject(reason: string): Promise<void> {
    setPending("reject");
    try {
      await api.actionProposals.reject(proposal.id, reason);
      toastSuccess(t.autopilotQueue.rejectSuccess);
      setShowReject(false);
      await invalidateQueue();
    } catch {
      toastError(t.autopilotQueue.rejectError);
    } finally {
      setPending(null);
    }
  }

  async function handleEditSubmit(editedContent: RestockEditedContent): Promise<void> {
    setPending("edit");
    try {
      await api.actionProposals.edit(proposal.id, { ...editedContent });
      toastSuccess(t.autopilotQueue.editSuccess);
      setShowEdit(false);
      await invalidateQueue();
    } catch {
      toastError(t.autopilotQueue.editError);
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <Card data-testid={`proposal-card-${proposal.id}`} className="border-ivory-border bg-ivory-surface">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-bold text-ivory-text">{kindTitle(proposal.kind)}</h3>
          <AutopilotModeBadge mode="shadow" />
        </div>

        <p className="text-sm text-ivory-text3">
          <Bdi>{proposal.summary}</Bdi>
        </p>

        {renderDraftContent(proposal)}

        <div>
          <button
            type="button"
            aria-expanded={showCitations}
            onClick={() => setShowCitations((v) => !v)}
            className="text-xs font-semibold text-brand underline-offset-2 hover:underline"
          >
            {showCitations ? t.autopilotQueue.citedFactsHide : t.autopilotQueue.citedFactsShow}
          </button>
          {showCitations && (
            <ul className="mt-2 flex flex-col gap-1" aria-label={t.autopilotQueue.citedFactsLabel}>
              {proposal.citedFacts.map((fact, i) => (
                <li key={`${fact.sourceId}-${i}`} className="text-xs text-ivory-text3">
                  <span dir="ltr" className="font-mono">
                    {fact.sourceTable}
                  </span>{" "}
                  · {fact.kind} · {formatDateTime(fact.at)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleApprove} disabled={busy} data-testid={`approve-${proposal.id}`}>
            {t.autopilotQueue.approve}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowEdit(true)}
            disabled={busy}
            data-testid={`edit-${proposal.id}`}
          >
            {t.autopilotQueue.edit}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowReject(true)}
            disabled={busy}
            data-testid={`reject-${proposal.id}`}
          >
            {t.autopilotQueue.reject}
          </Button>
        </div>
      </CardContent>

      <RejectReasonDialog
        open={showReject}
        onOpenChange={setShowReject}
        onSubmit={handleReject}
        pending={pending === "reject"}
      />

      {proposal.kind === "restock_po_on_burn" ? (
        <RestockEditDialog
          open={showEdit}
          onOpenChange={setShowEdit}
          draftContent={proposal.draftContent as RestockEditDraftContent}
          onSubmit={handleEditSubmit}
          pending={pending === "edit"}
        />
      ) : (
        <EditUnavailableDialog open={showEdit} onOpenChange={setShowEdit} />
      )}
    </Card>
  );
}
