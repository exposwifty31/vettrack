import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DeployabilityBadge } from "@/components/equipment/DeployabilityBadge";
import { EquipmentConfirmInRoomSheet } from "@/components/equipment/EquipmentConfirmInRoomSheet";
import {
  formatCitationObservedAt,
  formatTruthLocationSummary,
  formatTruthUnknown,
} from "@/lib/equipment-truth-display";
import {
  getLatestRfidCitation,
  truthHasPassiveRfidSignal,
  truthNeedsLocationConfirm,
} from "@/lib/equipment-truth-passive";
import type { CustodyState, ReadinessState, UsageState } from "@/types";
import { ChevronDown, ChevronUp, HelpCircle, MapPin, Radio, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface EquipmentTruthCardProps {
  equipmentId: string;
  equipmentName: string;
  enabled?: boolean;
  className?: string;
}

export function EquipmentTruthCard({
  equipmentId,
  equipmentName,
  enabled = true,
  className,
}: EquipmentTruthCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [confirmRoomOpen, setConfirmRoomOpen] = useState(false);

  const truthQ = useQuery({
    queryKey: ["equipment-truth", equipmentId],
    queryFn: () => api.equipment.truth(equipmentId),
    enabled: enabled && !!equipmentId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (truthQ.isLoading) {
    return (
      <Card className={cn("border-primary/20 bg-card shadow-sm", className)} data-testid="equipment-truth-card">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (truthQ.isError || !truthQ.data) {
    return (
      <Card
        className={cn("border-dashed border-border/80 bg-muted/30", className)}
        data-testid="equipment-truth-card"
      >
        <CardContent className="p-4 text-sm text-muted-foreground">
          {t.equipmentTruth.loadFailed}
        </CardContent>
      </Card>
    );
  }

  const truth = truthQ.data;
  const locationLabel = formatTruthLocationSummary(truth.location.summary);
  const custodianClaim = truth.custodian.claims.find((c) => c.key === "custodian");
  const custodianLabel =
    custodianClaim?.value === "none" || truth.custodian.unknowns.includes("no_active_custodian")
      ? t.equipmentTruth.noCustodian
      : custodianClaim?.value ?? t.equipmentTruth.custodianUnknown;

  const allUnknowns = [
    ...truth.location.unknowns,
    ...truth.deployability.unknowns,
    ...truth.custodian.unknowns,
  ];
  const uniqueUnknowns = [...new Set(allUnknowns)];

  const gateReason = !truth.deployability.bundleGate.ok
    ? truth.deployability.bundleGate.reason
    : null;

  const needsConfirm = truthNeedsLocationConfirm(truth);
  const passiveRfid = getLatestRfidCitation(truth.citations);
  const showPassiveRfid = passiveRfid && truthHasPassiveRfidSignal(truth);

  return (
    <>
      <Card
        className={cn("border-primary/25 bg-card shadow-md ring-1 ring-primary/10", className)}
        data-testid="equipment-truth-card"
      >
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
              {t.equipmentTruth.title}
            </CardTitle>
            <DeployabilityBadge
              custodyState={truth.deployability.custodyState as CustodyState}
              readinessState={truth.deployability.readinessState as ReadinessState}
              usageState={truth.deployability.usageState as UsageState}
              fullDeployable={truth.deployability.fullDeployable}
            />
          </div>
          <p className="text-xs text-muted-foreground font-normal">{t.equipmentTruth.subtitle}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{t.equipmentTruth.whereLabel}</p>
              <p className="text-sm font-semibold leading-snug">{locationLabel}</p>
            </div>
          </div>

          {showPassiveRfid && passiveRfid && (
            <div
              className="flex items-start gap-2 rounded-lg border border-blue-200/80 bg-blue-50/80 dark:bg-blue-950/40 dark:border-blue-800/60 px-3 py-2"
              data-testid="equipment-truth-passive-rfid"
            >
              <Radio className="w-4 h-4 text-blue-700 dark:text-blue-300 shrink-0 mt-0.5" />
              <div className="min-w-0 text-xs">
                <p className="font-semibold text-blue-950 dark:text-blue-100">
                  {t.equipmentTruth.passiveRfidTitle}
                </p>
                <p className="text-blue-900/90 dark:text-blue-200/90 mt-0.5">
                  {t.equipmentTruth.passiveRfidDetail(
                    passiveRfid.label,
                    formatCitationObservedAt(passiveRfid.evidence.observedAt),
                  )}
                </p>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-muted-foreground">{t.equipmentTruth.holderLabel}</p>
            <p className="text-sm">{custodianLabel}</p>
          </div>

          {gateReason && (
            <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 rounded-lg px-3 py-2 border border-amber-200/80">
              {gateReason}
            </p>
          )}

          {uniqueUnknowns.length > 0 && (
            <div
              className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2"
              data-testid="equipment-truth-unknowns"
            >
              <HelpCircle className="w-4 h-4 shrink-0 text-muted-foreground mt-0.5" />
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{t.equipmentTruth.gapsLabel}</p>
                <ul className="text-xs space-y-0.5 list-disc ps-4">
                  {uniqueUnknowns.map((u) => (
                    <li key={u}>{formatTruthUnknown(u)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {(needsConfirm || showPassiveRfid) && (
            <Button
              type="button"
              variant="secondary"
              className="w-full h-11"
              onClick={() => setConfirmRoomOpen(true)}
              data-testid="equipment-truth-confirm-in-room"
            >
              <MapPin className="w-4 h-4 me-2" />
              {t.equipmentTruth.confirmInRoomButton}
            </Button>
          )}

          {truth.citations.length > 0 && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-full justify-between px-2 text-xs font-medium"
                onClick={() => setEvidenceOpen((o) => !o)}
                data-testid="equipment-truth-evidence-toggle"
              >
                {t.equipmentTruth.evidenceToggle(truth.citations.length)}
                {evidenceOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
              {evidenceOpen && (
                <ul
                  className="mt-2 space-y-2 max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2"
                  data-testid="equipment-truth-citations"
                >
                  {truth.citations.map((c) => (
                    <li key={`${c.type}:${c.id}`} className="text-xs flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {c.type}
                      </Badge>
                      <span className="font-medium">{c.label}</span>
                      <span className="text-muted-foreground">
                        {formatCitationObservedAt(c.evidence.observedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <EquipmentConfirmInRoomSheet
        equipmentId={equipmentId}
        equipmentName={equipmentName}
        open={confirmRoomOpen}
        onOpenChange={setConfirmRoomOpen}
        onConfirmed={() => truthQ.refetch()}
      />
    </>
  );
}
