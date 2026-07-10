import { Link } from "wouter";
import { Package } from "lucide-react";
import { Bdi } from "@/components/ui/bdi";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { LoadingSection } from "@/components/ui/loading-section";
import { t } from "@/lib/i18n";
import type { Equipment } from "@/types";

const MAX_ROWS = 4;

/**
 * Floor "equipment in my care" tile — items checked out to the current user
 * (GET /api/equipment/my). Each row links to the item; a readiness chip flags
 * anything not ready. Empty state when nothing is checked out.
 */
export function MyEquipmentCard({
  items,
  isLoading,
  isError = false,
  onRetry,
}: {
  items: Equipment[] | undefined;
  isLoading: boolean;
  /** When the /api/equipment/my read rejected — render a retryable failure state
      instead of a silent empty card. */
  isError?: boolean;
  onRetry?: () => void;
}) {
  const rows = items ?? [];
  return (
    <section className="rounded-2xl border border-ivory-border bg-ivory-surface p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Package className="h-[18px] w-[18px] text-ivory-text3" aria-hidden />
        <span className="text-[15px] font-bold text-ivory-text">{t.homeSurface.myEquipment}</span>
        {rows.length > 0 && (
          <span className="ms-auto text-[13px] font-medium text-ivory-text3">
            {rows.length} {t.homeSurface.inYourCare}
          </span>
        )}
      </div>

      {isLoading ? (
        <LoadingSection rows={3} />
      ) : isError ? (
        <div className="flex flex-col items-start gap-2 py-1" role="alert">
          <p className="text-sm text-ivory-text3">{t.equipmentList.errors.loadFailed}</p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry()}
              className="min-h-[36px] rounded-lg border border-ivory-border px-3 text-sm font-medium text-ivory-text transition-colors hover:bg-muted/40"
            >
              {t.common.tryAgain}
            </button>
          )}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-1 text-sm text-ivory-text3">{t.homeSurface.myEquipmentEmpty}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.slice(0, MAX_ROWS).map((item) => (
            <Link
              key={item.id}
              href={`/equipment/${item.id}`}
              className="flex items-center gap-2.5 rounded-lg px-1 py-2 transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ivory-text">
                <Bdi>{item.name}</Bdi>
              </span>
              <ReadinessChip state={item.readinessState} />
              <ForwardChevron className="h-4 w-4 shrink-0 opacity-40" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ReadinessChip({ state }: { state?: "ready" | "not_ready" | "unknown" | null }) {
  if (state !== "not_ready") return null;
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: "rgb(var(--sys-orange) / 0.12)", color: "rgb(var(--sys-orange))" }}
    >
      {t.homeSurface.notReady}
    </span>
  );
}
