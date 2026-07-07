import { Link } from "wouter";
import { ListTodo } from "lucide-react";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { LoadingSection } from "@/components/ui/loading-section";
import { t } from "@/lib/i18n";
import type { TaskDashboard } from "@/types/tasks";

/**
 * Floor tasks glance. The actionable read is the two counts (today / overdue) with
 * a CTA to the full tasks page — both server-backed via `taskDashboard.counts`.
 * Overdue is tinted when non-zero (semantic color). Empty state when nothing is due.
 */
export function TasksPreviewCard({
  dashboard,
  isLoading,
}: {
  dashboard: TaskDashboard | undefined;
  isLoading: boolean;
}) {
  const todayCount = dashboard?.counts.today ?? 0;
  const overdueCount = dashboard?.counts.overdue ?? 0;
  const isEmpty = !isLoading && todayCount === 0 && overdueCount === 0;

  return (
    <section className="rounded-2xl border border-ivory-border bg-ivory-surface p-4 shadow-card">
      <Link href="/equipment/tasks" className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[15px] font-bold text-ivory-text">
          <ListTodo className="h-[18px] w-[18px] text-ivory-text3" aria-hidden />
          {t.homeSurface.tasks}
        </span>
        <ForwardChevron className="h-4 w-4 opacity-50" aria-hidden />
      </Link>

      {isLoading ? (
        <LoadingSection rows={2} />
      ) : isEmpty ? (
        <p className="py-1 text-sm text-ivory-text3">{t.homeSurface.tasksEmpty}</p>
      ) : (
        <div className="flex items-stretch gap-3">
          <TaskStat count={todayCount} label={t.homeSurface.today} tone="neutral" href="/equipment/tasks" />
          <div className="w-px self-stretch bg-ivory-border" aria-hidden />
          <TaskStat
            count={overdueCount}
            label={t.homeSurface.overdue}
            tone={overdueCount > 0 ? "warn" : "neutral"}
            href="/equipment/tasks?filter=overdue"
          />
        </div>
      )}
    </section>
  );
}

function TaskStat({
  count,
  label,
  tone,
  href,
}: {
  count: number;
  label: string;
  tone: "neutral" | "warn";
  href: string;
}) {
  const color = tone === "warn" ? "rgb(var(--sys-orange))" : "var(--ivory-text)";
  return (
    <Link href={href} className="flex-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-muted/40">
      <p className="font-num text-[1.75rem] font-semibold leading-none tabular-nums" style={{ color }}>
        {count}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-ivory-text3">
        {label}
      </p>
    </Link>
  );
}
