import { Link } from "wouter";
import { Plus } from "lucide-react";
import { t } from "@/lib/i18n";

/**
 * Empty-clinic get-started state (extracted from home.tsx). Rendered by both
 * surfaces when the clinic has no equipment yet. `visible` is the caller's
 * `!equipmentLoading && totalCount === 0` gate — returns null otherwise.
 */
export function GetStartedCard({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="rounded-2xl border border-ivory-border bg-ivory-surface p-5 text-center shadow-card">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
        <Plus className="h-6 w-6 text-foreground/70" aria-hidden />
      </div>
      <h3 className="mb-1 text-[1.176rem] font-bold text-ivory-text">{t.homePage.getStarted}</h3>
      <p className="mb-4 text-sm text-ivory-text3">{t.homePage.getStartedDescription}</p>
      <Link
        href="/equipment/new"
        data-testid="btn-get-started"
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-deep)] px-5 text-sm font-bold text-white"
      >
        <Plus className="h-4 w-4" aria-hidden />
        {t.home.addEquipment}
      </Link>
    </div>
  );
}
