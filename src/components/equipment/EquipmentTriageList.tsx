import { Link } from "wouter";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";
import { SectionList } from "@/components/ui/section-list";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  equipmentTriageTier,
  TRIAGE_ORDER,
  type EquipmentTriageTier,
  normalizeStatus,
} from "@/lib/design-tokens";
import type { Equipment } from "@/types";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { useDirection } from "@/hooks/useDirection";

const BAR_COLOR: Record<EquipmentTriageTier, string> = {
  attention: "var(--status-issue)",
  in_use: "var(--brand)",
  operational: "var(--action)",
};

function tierLabel(tier: EquipmentTriageTier): string {
  switch (tier) {
    case "attention":
      return t.equipmentList.triageAttention;
    case "in_use":
      return t.equipmentList.triageInUse;
    default:
      return t.equipmentList.triageOperational;
  }
}

interface EquipmentTriageListProps {
  items: Equipment[];
  className?: string;
}

/** Mobile Pro list — triage sections, 3px status bar, mono meta. */
export function EquipmentTriageList({ items, className }: EquipmentTriageListProps) {
  const direction = useDirection();
  const Chevron = direction === "rtl" ? ChevronLeft : ChevronRight;

  const sorted = [...items].sort((a, b) => {
    const ta = TRIAGE_ORDER[equipmentTriageTier(a)];
    const tb = TRIAGE_ORDER[equipmentTriageTier(b)];
    return ta - tb;
  });

  const tiers: EquipmentTriageTier[] = ["attention", "in_use", "operational"];
  const sections = tiers.map((tier) => ({
    key: tier,
    label: tierLabel(tier),
    items: sorted.filter((eq) => equipmentTriageTier(eq) === tier),
  }));

  return (
    <SectionList
      className={className}
      sections={sections}
      renderItem={(eq) => {
        const tier = equipmentTriageTier(eq);
        const updated = eq.lastSeen ?? eq.checkedOutAt ?? eq.createdAt;
        return (
          <Link
            href={`/equipment/${eq.id}`}
            className="eqp-row flex min-h-[56px] items-stretch gap-0 transition-colors motion-safe:active:bg-muted/50"
            data-testid={`equipment-triage-row-${eq.id}`}
          >
            <span
              className="w-[3px] shrink-0 self-stretch"
              style={{ background: BAR_COLOR[tier] }}
              aria-hidden
            />
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ivory-text"><Bdi>{getEquipmentDisplayName(eq)}</Bdi></p>
                <p className="font-num mt-0.5 truncate text-[11px] text-ivory-text3">
                  {eq.serialNumber || eq.id.slice(0, 8)}
                  {eq.location ? ` · ${eq.location}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge kind={normalizeStatus(eq.status)} />
                {updated && (
                  <span className="font-num text-[10px] text-ivory-text3">
                    {formatRelativeTime(updated)}
                  </span>
                )}
              </div>
              <Chevron className="h-4 w-4 shrink-0 text-ivory-text3" aria-hidden />
            </div>
          </Link>
        );
      }}
    />
  );
}

interface EquipmentStatStripProps {
  total: number;
  attention: number;
  inUse: number;
  className?: string;
}

export function EquipmentStatStrip({
  total,
  attention,
  inUse,
  className,
}: EquipmentStatStripProps) {
  const uptime = total > 0 ? Math.round(((total - attention) / total) * 100) : 0;
  const cells = [
    { v: total, l: t.equipmentList.statTotal, tone: "" },
    { v: attention, l: t.equipmentList.statAttention, tone: "err" as const },
    { v: inUse, l: t.equipmentList.statInUse, tone: "" },
    { v: `${uptime}%`, l: t.equipmentList.statUptime, tone: "ok" as const },
  ];

  return (
    <div className={cn("grid grid-cols-4 gap-2", className)}>
      {cells.map((c) => (
        <div
          key={c.l}
          className="rounded-lg border border-ivory-border bg-ivory-surface px-2 py-2 text-center"
        >
          <p
            className={cn(
              "font-num text-base font-bold tabular-nums",
              c.tone === "err" && "text-destructive",
              c.tone === "ok" && "text-[var(--action)]",
            )}
          >
            {c.v}
          </p>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-ivory-text3">
            {c.l}
          </p>
        </div>
      ))}
    </div>
  );
}
