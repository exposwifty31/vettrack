import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { readSeniorConflict, type CheckInRequest, type DoctorTeamRole } from "@/types/check-in";
import { TEAM_ROLES, isDoctorTeamRole, teamLabel } from "./team-labels";

type SwitchStep =
  | { kind: "closed" }
  | { kind: "team" }
  | { kind: "replace"; team: DoctorTeamRole; currentSeniorName: string | null };

/**
 * Doctor shift status + exit surface (spec §1). Renders on the profile page
 * for a vet whose open clinical check-in carries a doctor team role: the
 * on-shift status line (team label + senior marker when applicable) with an
 * end-shift action (server-confirmed close) and a switch-role action (the
 * transaction-safe /switch endpoint — close+open with no board gap).
 * Null for everyone else. All copy via t.doctorGate.*.
 */
export function DoctorShiftStatus() {
  const { role, isLoaded, isSignedIn } = useAuth();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [switchStep, setSwitchStep] = useState<SwitchStep>({ kind: "closed" });
  const [wantSenior, setWantSenior] = useState<boolean | null>(null);

  const enabled = isLoaded && isSignedIn && role === "vet";

  const activeQuery = useQuery({
    queryKey: ["/api/clinical-check-in/me/active"],
    queryFn: () => api.checkIn.active(),
    enabled,
  });
  const active = activeQuery.data?.active ?? null;
  const team = active && isDoctorTeamRole(active.operationalRole)
    ? active.operationalRole
    : null;

  const meQuery = useQuery({
    queryKey: ["/api/users/me", "doctor-gate"],
    queryFn: () => api.users.me(),
    enabled: enabled && team !== null,
  });
  const seniorDoctorEligible = meQuery.data?.seniorDoctorEligible === true;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/clinical-check-in/me/active"] });
    queryClient.invalidateQueries({ queryKey: ["/api/display/snapshot"] });
  };

  const closeMutation = useMutation({
    mutationFn: () => api.checkIn.close(),
    onSuccess: invalidate,
    onError: () => toast.error(t.doctorGate.checkInFailed),
  });

  const switchMutation = useMutation({
    mutationFn: (data: CheckInRequest) => api.checkIn.switch(data),
    onSuccess: () => {
      invalidate();
      setSwitchStep({ kind: "closed" });
    },
    onError: (err: unknown, variables) => {
      const conflict = readSeniorConflict(err);
      if (conflict) {
        setSwitchStep({
          kind: "replace",
          team: variables.operationalRole,
          currentSeniorName: conflict.currentSeniorName,
        });
        return;
      }
      toast.error(t.doctorGate.checkInFailed);
    },
  });

  if (!enabled || !active || !team) return null;

  // Toggle default: keep the caller's current senior state until they touch it.
  const isSeniorChecked = wantSenior ?? active.isSenior;

  return (
    <div
      data-testid="doctor-shift-status"
      className="flex flex-col gap-2 px-4 py-3"
    >
      <div className="flex items-baseline gap-1.5 text-sm font-medium">
        <span>{t.doctorGate.onShiftStatus(teamLabel(team))}</span>
        {active.isSenior && (
          <span className="text-muted-foreground">{t.doctorGate.onShiftSenior}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 flex-1"
          data-testid="doctor-status-switch-role"
          disabled={closeMutation.isPending}
          onClick={() => {
            setWantSenior(null);
            setSwitchStep({ kind: "team" });
          }}
        >
          {t.doctorGate.switchRole}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 flex-1"
          data-testid="doctor-status-end-shift"
          disabled={closeMutation.isPending}
          onClick={async () => {
            const confirmed = await confirm({
              title: t.doctorGate.endShiftConfirmTitle,
              description: t.doctorGate.endShiftConfirmBody,
              confirmLabel: t.doctorGate.endShift,
            });
            if (confirmed) closeMutation.mutate();
          }}
        >
          {t.doctorGate.endShift}
        </Button>
      </div>

      <Dialog
        open={switchStep.kind !== "closed"}
        onOpenChange={(open) => {
          if (!open) setSwitchStep({ kind: "closed" });
        }}
      >
        <DialogContent data-testid="doctor-switch-dialog" className="max-w-sm">
          {switchStep.kind === "team" && (
            <>
              <DialogHeader>
                <DialogTitle>{t.doctorGate.pickTeam}</DialogTitle>
              </DialogHeader>
              {seniorDoctorEligible && (
                <label className="flex items-center gap-2 text-sm min-h-11">
                  <Checkbox
                    checked={isSeniorChecked}
                    onCheckedChange={(checked) => setWantSenior(checked === true)}
                    disabled={switchMutation.isPending}
                    data-testid="doctor-switch-senior-toggle"
                  />
                  {t.doctorGate.iAmSenior}
                </label>
              )}
              <div className="flex flex-col gap-2">
                {TEAM_ROLES.map((nextTeam) => (
                  <Button
                    key={nextTeam}
                    variant="secondary"
                    className="min-h-11 w-full"
                    data-testid={`doctor-switch-team-${nextTeam}`}
                    disabled={switchMutation.isPending}
                    onClick={() =>
                      switchMutation.mutate({
                        operationalRole: nextTeam,
                        isSenior: seniorDoctorEligible && isSeniorChecked,
                        source: "doctor_gate",
                      })
                    }
                  >
                    {teamLabel(nextTeam)}
                  </Button>
                ))}
              </div>
            </>
          )}

          {switchStep.kind === "replace" && (
            <>
              <DialogHeader>
                <DialogTitle>{t.doctorGate.replaceSeniorTitle}</DialogTitle>
                <DialogDescription>
                  {t.doctorGate.replaceSeniorBody(
                    switchStep.currentSeniorName ?? "",
                    teamLabel(switchStep.team),
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-3">
                <Button
                  className="flex-1 min-h-11"
                  data-testid="doctor-switch-replace-confirm"
                  disabled={switchMutation.isPending}
                  onClick={() =>
                    switchMutation.mutate({
                      operationalRole: switchStep.team,
                      isSenior: true,
                      replaceSenior: true,
                      source: "doctor_gate",
                    })
                  }
                >
                  {t.doctorGate.replace}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 min-h-11"
                  data-testid="doctor-switch-replace-cancel"
                  disabled={switchMutation.isPending}
                  onClick={() => setSwitchStep({ kind: "team" })}
                >
                  {t.doctorGate.cancel}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
