export type TaskAction =
  | "task.read"
  | "task.create"
  | "task.assign"
  | "task.reassign"
  | "task.cancel"
  | "task.start"
  | "task.complete";

function normalizedRole(role: string | null | undefined): string {
  const normalized = (role ?? "").trim().toLowerCase();
  // Backward compatibility for legacy role values after Viewer -> Student rename.
  return normalized === "viewer" ? "student" : normalized;
}

/**
 * Task/appointment authorization policy.
 * Keep this small and explicit so route-level intent is easy to audit.
 *
 * Hierarchical superset (2026-08-07): senior roles inherit every action the
 * technician tier has (start/complete), so a vet can always do what a
 * technician can. `lead_technician` is the senior_technician alias tier
 * (ROLE_HIERARCHY lead=22, senior=25) and `vet_tech` the technician tier-20
 * peer (server/lib/authority-roles.ts aliases). Actions are enumerated
 * explicitly (no blanket `return true` for non-admin roles) so any future
 * TaskAction stays deny-by-default until deliberately granted.
 *
 * Ownership/assignment invariants are NOT decided here — the service layer
 * (`canBypassOwnership` in appointments.service.ts: admin/vet/senior only)
 * and the task-assignment evaluator own those.
 */
export function canPerformTaskAction(roleInput: string | null | undefined, action: TaskAction): boolean {
  const role = normalizedRole(roleInput);

  if (role === "admin") return true;

  if (role === "vet" || role === "senior_technician" || role === "lead_technician") {
    return (
      action === "task.read" ||
      action === "task.create" ||
      action === "task.assign" ||
      action === "task.reassign" ||
      action === "task.cancel" ||
      action === "task.start" ||
      action === "task.complete"
    );
  }

  if (role === "technician" || role === "vet_tech") {
    return action === "task.read" || action === "task.start" || action === "task.complete";
  }

  if (role === "student") {
    return false;
  }

  return false;
}
