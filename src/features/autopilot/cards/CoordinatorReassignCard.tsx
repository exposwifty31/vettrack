import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { ActionProposal } from "@/types/action-proposals";

interface CoordinatorCandidate {
  userId: string;
  name: string;
}

type ProposedReplacement =
  | { status: "auto"; coordinatorUserId: string; candidates: CoordinatorCandidate[]; suggestedFallbackUserId: string | null }
  | { status: "fallback_senior"; coordinatorUserId: string; candidates: CoordinatorCandidate[]; suggestedFallbackUserId: string }
  | { status: "needs_confirmation"; coordinatorUserId: null; candidates: CoordinatorCandidate[]; suggestedFallbackUserId: string | null }
  | { status: "unresolved"; coordinatorUserId: null; candidates: CoordinatorCandidate[]; suggestedFallbackUserId: null };

interface CoordinatorReassignDraftContent {
  shiftDate: string;
  staleCoordinatorUserId: string;
  escalationStage: number;
  proposedReplacement: ProposedReplacement;
  title: string;
  proposedCandidateLabel: string;
}

function statusLabel(status: ProposedReplacement["status"]): string {
  const k = t.autopilotQueue.kinds.coordinatorReassignOffRoster;
  switch (status) {
    case "auto":
      return k.statusAuto;
    case "fallback_senior":
      return k.statusFallbackSenior;
    case "needs_confirmation":
      return k.statusNeedsConfirmation;
    case "unresolved":
      return k.statusUnresolved;
  }
}

/** VetTrack 2.0, Task 1.1 §6 (deliverable C) — `coordinator_reassign_off_roster` minimal card. */
export function CoordinatorReassignCard({ proposal }: { proposal: ActionProposal }) {
  const content = proposal.draftContent as CoordinatorReassignDraftContent;
  const k = t.autopilotQueue.kinds.coordinatorReassignOffRoster;

  return (
    <div className="flex flex-col gap-2" data-testid="coordinator-reassign-card">
      <p className="text-sm">
        <span className="text-ivory-text3">{k.staleCoordinatorLabel}: </span>
        <Bdi dir="ltr">{content.staleCoordinatorUserId}</Bdi>
        <span className="text-ivory-text3"> · {k.escalationStageLabel}: {content.escalationStage}</span>
      </p>
      <p className="text-sm font-semibold">{statusLabel(content.proposedReplacement.status)}</p>
      {content.proposedReplacement.candidates.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-ivory-text3">{content.proposedCandidateLabel}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {content.proposedReplacement.candidates.map((candidate) => (
              <li key={candidate.userId} className="text-sm">
                <Bdi>{candidate.name}</Bdi>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
