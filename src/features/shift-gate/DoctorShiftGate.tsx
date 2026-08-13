import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { DoctorTeamRole } from "@/types/check-in";
import { useDoctorGateState } from "./useDoctorGateState";
import { TEAM_ROLES, teamLabel } from "./team-labels";

type GateStep =
  | { kind: "confirm" }
  | { kind: "team" }
  | { kind: "replace"; team: DoctorTeamRole; currentSeniorName: string | null };

type CheckInPayload = {
  operationalRole: DoctorTeamRole;
  isSenior?: boolean;
  replaceSenior?: boolean;
};

/**
 * Doctor shift gate popup (spec 2026-08-13). Self-contained: renders null
 * unless the signed-in user is a vet with no open clinical check-in and no
 * un-expired snooze. Mounted as a NativeShell sibling (MoreSheet pattern)
 * in both the phone and tablet branches.
 */
export function DoctorShiftGate() {
  const { shouldShow, seniorDoctorEligible, snooze } = useDoctorGateState();
  const [step, setStep] = useState<GateStep>({ kind: "confirm" });
  const [isSenior, setIsSenior] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();

  const checkInMutation = useMutation({
    mutationFn: (data: CheckInPayload) => api.checkIn.open(data),
    onSuccess: () => {
      // The board reads doctors from the snapshot's responsibles section;
      // the active-check-in query gates this popup itself.
      queryClient.invalidateQueries({ queryKey: ["/api/display/snapshot"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clinical-check-in/me/active"] });
      setDismissed(true);
    },
    onError: (err: unknown, variables) => {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === "SENIOR_ALREADY_ASSIGNED") {
        const details = (err as { payload?: { details?: Record<string, unknown> } })
          .payload?.details;
        const name =
          typeof details?.currentSeniorName === "string" ? details.currentSeniorName : null;
        setStep({ kind: "replace", team: variables.operationalRole, currentSeniorName: name });
        return;
      }
      toast.error(t.doctorGate.checkInFailed);
    },
  });

  if (!shouldShow || dismissed) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Mid-flow dismiss (X / overlay): soft-close for this mount only —
        // NO snooze is written, so the gate asks again on the next launch.
        if (!open) setDismissed(true);
      }}
    >
      <DialogContent data-testid="doctor-shift-gate" className="max-w-sm">
        {step.kind === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle>{t.doctorGate.areYouOnShift}</DialogTitle>
            </DialogHeader>
            <div className="flex gap-3">
              <Button
                className="flex-1 min-h-11"
                data-testid="doctor-gate-yes"
                onClick={() => setStep({ kind: "team" })}
              >
                {t.doctorGate.yes}
              </Button>
              <Button
                variant="outline"
                className="flex-1 min-h-11"
                data-testid="doctor-gate-no"
                onClick={() => snooze()}
              >
                {t.doctorGate.no}
              </Button>
            </div>
          </>
        )}

        {step.kind === "team" && (
          <>
            <DialogHeader>
              <DialogTitle>{t.doctorGate.pickTeam}</DialogTitle>
            </DialogHeader>
            {seniorDoctorEligible && (
              <label className="flex items-center gap-2 text-sm min-h-11">
                <Checkbox
                  checked={isSenior}
                  onCheckedChange={(checked) => setIsSenior(checked === true)}
                  disabled={checkInMutation.isPending}
                  data-testid="doctor-gate-senior-toggle"
                />
                {t.doctorGate.iAmSenior}
              </label>
            )}
            <div className="flex flex-col gap-2">
              {TEAM_ROLES.map((team) => (
                <Button
                  key={team}
                  variant="secondary"
                  className="min-h-11 w-full"
                  data-testid={`doctor-gate-team-${team}`}
                  disabled={checkInMutation.isPending}
                  onClick={() => checkInMutation.mutate({ operationalRole: team, isSenior })}
                >
                  {teamLabel(team)}
                </Button>
              ))}
            </div>
          </>
        )}

        {step.kind === "replace" && (
          <>
            <DialogHeader>
              <DialogTitle>{t.doctorGate.replaceSeniorTitle}</DialogTitle>
              <DialogDescription>
                {t.doctorGate.replaceSeniorBody(
                  step.currentSeniorName ?? "",
                  teamLabel(step.team),
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3">
              <Button
                className="flex-1 min-h-11"
                data-testid="doctor-gate-replace-confirm"
                disabled={checkInMutation.isPending}
                onClick={() =>
                  checkInMutation.mutate({
                    operationalRole: step.team,
                    isSenior: true,
                    replaceSenior: true,
                  })
                }
              >
                {t.doctorGate.replace}
              </Button>
              <Button
                variant="outline"
                className="flex-1 min-h-11"
                data-testid="doctor-gate-replace-cancel"
                disabled={checkInMutation.isPending}
                onClick={() => setStep({ kind: "team" })}
              >
                {t.doctorGate.cancel}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
