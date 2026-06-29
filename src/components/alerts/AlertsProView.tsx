import { Link } from "wouter";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SectionList } from "@/components/ui/section-list";
import { Button } from "@/components/ui/button";
import { ForwardChevron } from "@/components/ui/directional-chevron";
import { UserCheck, X } from "lucide-react";
import type { Alert, AlertAcknowledgment, AlertType } from "@/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeStatus } from "@/lib/design-tokens";
import { useEnterOnce } from "@/hooks/use-enter-once";

const URGENT_TYPES: AlertType[] = ["issue", "overdue"];
const MAINT_TYPES: AlertType[] = ["sterilization_due", "inactive"];

function alertTone(type: AlertType): "err" | "warn" {
  return type === "issue" ? "err" : "warn";
}

interface AlertsProViewProps {
  alerts: Alert[];
  acksMap: Map<string, AlertAcknowledgment>;
  equipmentLocationMap: Map<string, string>;
  hasAckError: boolean;
  onNavigate: (equipmentId: string) => void;
  onAck: (equipmentId: string, alertType: string) => void;
  onUnAck: (equipmentId: string, alertType: string) => void;
  /** Ownership (take/release) is restricted to the equipment-management tier. When
   *  false, status stays visible (who's handling) but the claim/release controls hide. */
  canOwn: boolean;
  formatRelativeTime: (date: Date) => string;
}

/** Mobile Alerts Pro — worst-first hero + triage sections (design handoff). */
export function AlertsProView({
  alerts,
  acksMap,
  equipmentLocationMap,
  hasAckError,
  onNavigate,
  onAck,
  onUnAck,
  canOwn,
  formatRelativeTime,
}: AlertsProViewProps) {
  const enterOnce = useEnterOnce("alerts");
  const rise = enterOnce ? "vt-pro-rise" : "";

  const sorted = [...alerts].sort((a, b) => {
    const order: AlertType[] = ["issue", "overdue", "sterilization_due", "inactive"];
    return order.indexOf(a.type) - order.indexOf(b.type);
  });

  const urgent = sorted.filter((a) => URGENT_TYPES.includes(a.type));
  const maintenance = sorted.filter((a) => MAINT_TYPES.includes(a.type));
  const worst = sorted[0];

  const sections = [
    { key: "urgent", label: t.alertsPage.sectionUrgent, items: urgent },
    { key: "maint", label: t.alertsPage.sectionMaintenance, items: maintenance },
  ].filter((s) => s.items.length > 0);

  return (
    <div className={cn("flex flex-col gap-4 pb-4", enterOnce && "vt-enter-stagger")}>
      {worst && (
        <div
          className={cn(
            "relative overflow-hidden rounded-2xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-4",
            rise,
          )}
          data-testid="alerts-worst-first"
        >
          <div
            className="pointer-events-none absolute -end-8 -top-8 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgba(220,38,38,0.14),transparent_70%)]"
            aria-hidden
          />
          <div className="relative">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 vt-text-2xs font-bold uppercase tracking-[0.14em] text-[var(--status-issue-fg)]">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-[var(--status-issue)]" />
                  {enterOnce && (
                    <span className="absolute inset-0 rounded-full bg-[var(--status-issue)] motion-safe:animate-[alertPing_2.2s_ease-out_infinite]" />
                  )}
                </span>
                {t.alertsPage.worstFirst}
              </span>
            </div>
            <h2 className="vt-text-lg font-bold leading-snug tracking-tight text-[var(--status-issue-fg)]">
              {worst.equipmentName}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[var(--status-issue-fg)]/85">
              {worst.detail}
              {equipmentLocationMap.get(worst.equipmentId)
                ? ` · ${equipmentLocationMap.get(worst.equipmentId)}`
                : ""}
            </p>
            <Button
              type="button"
              className="mt-3 h-12 w-full rounded-lg bg-[var(--status-issue-fg)] text-sm font-semibold text-white hover:bg-[var(--status-issue-fg)]/90"
              onClick={() => onNavigate(worst.equipmentId)}
              data-testid="btn-alerts-handle-worst"
            >
              {t.alertsPage.handleNow}
              <ForwardChevron className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      <p className={cn("px-0.5 text-xs text-ivory-text3", rise)}>
        {t.alertsPage.openSummary(alerts.length, urgent.length)}
      </p>

      <SectionList
        sections={sections}
        renderItem={(alert) => {
          const tone = alertTone(alert.type);
          const ackKey = `${alert.equipmentId}:${alert.type}`;
          const ack = acksMap.get(ackKey);
          const bar =
            tone === "err" ? "hsl(var(--status-issue))" : "hsl(var(--status-maintenance))";

          return (
            <div className="flex min-h-14 items-stretch">
              <span className="w-1 shrink-0 self-stretch" style={{ background: bar }} aria-hidden />
            <StatusBadge kind={normalizeStatus(tone)} className="self-center ms-1" />
              <div className="min-w-0 flex-1 px-3 py-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex w-full items-start gap-2 text-start motion-safe:active:opacity-80 h-auto p-0"
                  onClick={() => onNavigate(alert.equipmentId)}
                  data-testid={`alert-navigate-${alert.equipmentId}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate vt-text-sm font-semibold text-ivory-text">
                      {alert.equipmentName}
                    </p>
                    <p className="mt-0.5 line-clamp-2 vt-text-2xs text-ivory-text3">{alert.detail}</p>
                  </div>
                  <ForwardChevron className="mt-0.5 h-4 w-4 shrink-0 text-ivory-text3" aria-hidden />
                </Button>
                <div className="mt-2">
                  {ack ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                        <span className="truncate vt-text-2xs text-ivory-text2">
                          {ack.acknowledgedByEmail.split("@")[0]} ·{" "}
                          {formatRelativeTime(new Date(ack.acknowledgedAt))}
                        </span>
                      </div>
                      {canOwn && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-9 w-9 shrink-0"
                          disabled={hasAckError}
                          onClick={() => onUnAck(alert.equipmentId, alert.type)}
                          aria-label={t.alertsPage.removeAckAria}
                        >
                          <X className="h-3 w-3" aria-hidden />
                        </Button>
                      )}
                    </div>
                  ) : canOwn ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 w-full text-xs"
                      disabled={hasAckError}
                      onClick={() => onAck(alert.equipmentId, alert.type)}
                      data-testid={`btn-ack-${alert.equipmentId}`}
                    >
                      <UserCheck className="h-3.5 w-3.5 me-1.5" aria-hidden />
                      {t.alertsPage.takeOwnership}
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          );
        }}
      />

      <Link
        href="/equipment"
        className="text-center text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        {t.alertsPage.browseEquipment}
      </Link>
    </div>
  );
}
