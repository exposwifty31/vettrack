import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { CheckCircle, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorCard } from "@/components/ui/error-card";
import { Bdi } from "@/components/ui/bdi";
import { TwoPaneLayout } from "@/native/tablet/TwoPaneLayout";
import { SelectItemPlaceholder } from "@/native/tablet/SelectItemPlaceholder";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { t } from "@/lib/i18n";
import { useProposalQueue } from "@/features/autopilot/use-proposal-queue";
import { ProposalQueueList } from "@/features/autopilot/ProposalQueueList";
import { ProposalCard } from "@/features/autopilot/ProposalCard";
import { renderDraftContentForKind } from "@/features/autopilot/render-draft-content";
import { kindTitle } from "@/features/autopilot/kind-title";

/**
 * VetTrack 2.0, Task 1.1 §6 (deliverable G) — console (≥1024px) master-detail
 * variant, per the `EquipmentMasterDetail` convention: a compact selectable
 * row list on the left, the selected proposal's full `ProposalCard`
 * (SAME component the mobile list renders — no divergent detail rendering)
 * on the right.
 */
function AutopilotQueueConsole() {
  const { data, isLoading, isError, refetch } = useProposalQueue({ status: "staged" });
  const proposals = data?.proposals ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = proposals.find((p) => p.id === selectedId) ?? null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-ivory-text3" role="status" aria-busy="true">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        <span className="sr-only">{t.common.loading}</span>
      </div>
    );
  }
  if (isError) {
    return <ErrorCard message={t.autopilotQueue.loadFailed} onRetry={refetch} />;
  }

  return (
    <TwoPaneLayout
      masterLabel={t.autopilotQueue.title}
      detailLabel={t.autopilotQueue.title}
      master={
        proposals.length === 0 ? (
          <EmptyState icon={CheckCircle} message={t.autopilotQueue.empty} />
        ) : (
          <div role="list" aria-live="polite" data-testid="proposal-queue-console-list">
            {proposals.map((proposal) => (
              <button
                key={proposal.id}
                type="button"
                role="listitem"
                data-testid={`proposal-row-${proposal.id}`}
                aria-current={proposal.id === selectedId}
                onClick={() => setSelectedId(proposal.id)}
                className="flex w-full flex-col gap-0.5 border-b border-ivory-border px-3 py-2.5 text-start transition-colors hover:bg-muted/40 aria-[current=true]:bg-muted/60"
              >
                <span className="text-xs font-bold text-ivory-text3">{kindTitle(proposal.kind)}</span>
                <Bdi className="truncate text-sm text-ivory-text">{proposal.summary}</Bdi>
              </button>
            ))}
          </div>
        )
      }
      detail={
        selected ? (
          <div className="p-3">
            <ProposalCard proposal={selected} renderDraftContent={renderDraftContentForKind} />
          </div>
        ) : null
      }
      placeholder={<SelectItemPlaceholder />}
    />
  );
}

export default function AutopilotQueuePage() {
  const isDesktop = useIsDesktop();

  return (
    <AppShell>
      <Helmet>
        <title>{t.autopilotQueue.title} — VetTrack</title>
      </Helmet>
      <div className="flex h-full min-h-0 flex-col gap-4 px-4 pb-nav-safe pt-3 sm:px-6">
        <h1 className="vt-page-title">{t.autopilotQueue.title}</h1>
        <div className="min-h-0 flex-1">
          {isDesktop ? <AutopilotQueueConsole /> : <ProposalQueueList />}
        </div>
      </div>
    </AppShell>
  );
}
