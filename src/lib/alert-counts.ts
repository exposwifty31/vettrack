import type { Alert, AlertAcknowledgment, AlertType } from "@/types";

/** Stable key for alert acknowledgment lookups. */
export function alertAckKey(equipmentId: string, alertType: AlertType | string): string {
  return `${equipmentId}:${alertType}`;
}

export function buildAlertAckSet(acks: AlertAcknowledgment[] | undefined): Set<string> {
  return new Set((acks ?? []).map((a) => alertAckKey(a.equipmentId, a.alertType)));
}

export function isAlertAcked(
  alert: Alert,
  acks: Set<string> | Map<string, AlertAcknowledgment>,
): boolean {
  const key = alertAckKey(alert.equipmentId, alert.type);
  return acks instanceof Map ? acks.has(key) : acks.has(key);
}

export function filterUnackedAlerts(
  alerts: Alert[],
  acks?: Set<string> | Map<string, AlertAcknowledgment>,
): Alert[] {
  if (!acks || (acks instanceof Set && acks.size === 0)) return alerts;
  return alerts.filter((a) => !isAlertAcked(a, acks));
}

/** Matches AlertsProView urgent section: open issues + overdue maintenance. */
export function isUrgentAlert(alert: Alert): boolean {
  return alert.type === "issue" || alert.type === "overdue";
}

export function countUrgentAlerts(
  alerts: Alert[],
  acks?: Set<string> | Map<string, AlertAcknowledgment>,
): number {
  return filterUnackedAlerts(alerts.filter(isUrgentAlert), acks).length;
}

export function countCriticalAlerts(
  alerts: Alert[],
  acks?: Set<string> | Map<string, AlertAcknowledgment>,
): number {
  return filterUnackedAlerts(
    alerts.filter((a) => a.severity === "critical"),
    acks,
  ).length;
}

/** Nav badge + alerts page total — unacknowledged alerts only when ack set provided. */
export function countActiveAlerts(
  alerts: Alert[],
  acks?: Set<string> | Map<string, AlertAcknowledgment>,
): number {
  return filterUnackedAlerts(alerts, acks).length;
}
