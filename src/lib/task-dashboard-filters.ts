import type { Appointment } from "@/types";

/** Internal QA / stability tasks — hide from home "next up" and shift pulse. */
export function isInternalDashboardTask(task: { notes?: string | null }): boolean {
  const notes = task.notes?.trim() ?? "";
  if (!notes) return false;
  if (/^environment setup verification$/i.test(notes)) return true;
  if (/^\[(stability|e2e|qa)\]/i.test(notes)) return true;
  return false;
}

export function filterDashboardTasks(tasks: Appointment[]): Appointment[] {
  return tasks.filter((t) => !isInternalDashboardTask(t));
}

export function pickNextDashboardTask(dashboard: {
  overdue: Appointment[];
  today: Appointment[];
  upcoming: Appointment[];
}): Appointment | null {
  const overdue = filterDashboardTasks(dashboard.overdue);
  const today = filterDashboardTasks(dashboard.today);
  const upcoming = filterDashboardTasks(dashboard.upcoming);
  return overdue[0] ?? today[0] ?? upcoming[0] ?? null;
}
