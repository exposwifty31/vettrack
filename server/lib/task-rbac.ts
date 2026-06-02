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
 */
export function canPerformTaskAction(roleInput: string | null | undefined, action: TaskAction): boolean {
  const role = normalizedRole(roleInput);

  if (role === "admin") return true;

  if (role === "vet" || role === "senior_technician") {
    return (
      action === "task.read" ||
      action === "task.create" ||
      action === "task.assign" ||
      action === "task.reassign" ||
      action === "task.cancel"
    );
  }

  if (role === "technician") {
    return action === "task.read" || action === "task.start" || action === "task.complete";
  }

  if (role === "student") {
    return false;
  }

  return false;
}
