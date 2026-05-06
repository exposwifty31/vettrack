import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNow, format, isAfter, subDays } from "date-fns";
import type { Equipment, Alert, AlertType, AlertSeverity, EquipmentStatus } from "@/types";
import { ALERT_SEVERITY } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(date: string | null | undefined): string {
  if (!date) return "Never";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  try {
    return format(new Date(date), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

export function formatDateTime(date: string | null | undefined): string {
  if (!date) return "—";
  try {
    return format(new Date(date), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return "—";
  }
}

export function isOverdue(equipment: Equipment): boolean {
  if (!equipment.maintenanceIntervalDays || !equipment.lastMaintenanceDate) {
    return false;
  }
  const dueDate = new Date(equipment.lastMaintenanceDate);
  dueDate.setDate(dueDate.getDate() + equipment.maintenanceIntervalDays);
  return isAfter(new Date(), dueDate);
}

export function isSterilizationDue(equipment: Equipment): boolean {
  if (!equipment.lastSterilizationDate) return false;
  const sevenDaysAgo = subDays(new Date(), 7);
  return isAfter(sevenDaysAgo, new Date(equipment.lastSterilizationDate));
}

export function isInactive(equipment: Equipment): boolean {
  if (!equipment.lastSeen) return true;
  const fourteenDaysAgo = subDays(new Date(), 14);
  return isAfter(fourteenDaysAgo, new Date(equipment.lastSeen));
}

export type ExpiryBadgeState = "expired" | "expiring_soon" | "healthy";

export function getExpiryBadgeState(
  expiryDate: string | null | undefined,
  now: Date = new Date(),
): ExpiryBadgeState | null {
  if (!expiryDate) return null;
  const date = new Date(`${expiryDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  const daysUntilExpiry = Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= 7) return "expiring_soon";
  return "healthy";
}

// Runtime allowlist — only these types may be emitted; update AlertType in @/types and ALERT_SEVERITY together
const ALERT_TYPE_ALLOWLIST = new Set<Alert["type"]>(["issue", "overdue", "sterilization_due", "inactive"]);

export function computeAlerts(equipment: Equipment[]): Alert[] {
  const alerts: Alert[] = [];

  for (const eq of equipment) {
    if (eq.lastStatus === "issue") {
      alerts.push({
        type: "issue",
        severity: ALERT_SEVERITY["issue"],
        equipmentId: eq.id,
        equipmentName: eq.name,
        detail: "Reported issue not resolved",
      });
    } else if (isOverdue(eq)) {
      const dueDate = new Date(eq.lastMaintenanceDate!);
      dueDate.setDate(dueDate.getDate() + eq.maintenanceIntervalDays!);
      const daysOverdue = Math.ceil(
        (new Date().getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      alerts.push({
        type: "overdue",
        severity: ALERT_SEVERITY["overdue"],
        equipmentId: eq.id,
        equipmentName: eq.name,
        detail: `${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue`,
        daysOverdue,
      });
    } else if (isSterilizationDue(eq)) {
      alerts.push({
        type: "sterilization_due",
        severity: ALERT_SEVERITY["sterilization_due"],
        equipmentId: eq.id,
        equipmentName: eq.name,
        detail: "Not sterilized in 7+ days",
      });
    } else if (isInactive(eq)) {
      alerts.push({
        type: "inactive",
        severity: ALERT_SEVERITY["inactive"],
        equipmentId: eq.id,
        equipmentName: eq.name,
        detail: "No scan in 14+ days",
      });
    }
  }

  return alerts.filter((a) => ALERT_TYPE_ALLOWLIST.has(a.type));
}

/**
 * Normalize a phone number to E.164 format with a leading '+'.
 * Supports Israeli local format (05X...) → +972 5X...
 * and any number already in international format (+972... or +1...).
 * Use this when passing a phone number to Clerk or any auth service.
 *
 * NOTE (Clerk Dashboard): For Israeli SMS OTP to work, Israel (+972) must be
 * enabled in the Clerk Dashboard under Configure → User & Authentication →
 * Phone numbers → SMS sending → Allowed countries. This cannot be changed in code.
 */
export function normalizePhoneE164(phone: string): string {
  const trimmed = phone.trim();
  const stripped = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    return "+" + stripped;
  }
  if (stripped.startsWith("972")) {
    return "+" + stripped;
  }
  if (stripped.startsWith("05") && stripped.length >= 9 && stripped.length <= 10) {
    return "+972" + stripped.slice(1);
  }
  return "+" + stripped;
}

/**
 * Normalize a phone number to digits-only format suitable for wa.me URLs.
 * wa.me expects the full number without '+' (e.g. 972501234567).
 * Supports Israeli local format (05X...) → 9725X...
 */
export function normalizePhoneNumber(phone: string): string {
  return normalizePhoneE164(phone).replace(/^\+/, "");
}

export type WhatsAppMessageLabels = {
  alertTitle: string;
  equipmentLabel: string;
  statusLabel: string;
  timeLabel: string;
  noteLabel: string;
  actionRequired: string;
};

const DEFAULT_WA_LABELS: WhatsAppMessageLabels = {
  alertTitle: "🚨 VetTrack Alert",
  equipmentLabel: "Equipment",
  statusLabel: "Status",
  timeLabel: "Time",
  noteLabel: "Note",
  actionRequired: "Please address this issue immediately.",
};

export function buildWhatsAppUrl(
  phone: string | undefined,
  equipmentName: string,
  status: EquipmentStatus | string,
  note?: string,
  labels: WhatsAppMessageLabels = DEFAULT_WA_LABELS
): string {
  const timestamp = format(new Date(), "dd/MM/yyyy HH:mm");
  let message = `${labels.alertTitle}\n\n${labels.equipmentLabel}: *${equipmentName}*\n${labels.statusLabel}: *${String(status).toUpperCase()}*\n${labels.timeLabel}: ${timestamp}`;
  if (note) {
    message += `\n${labels.noteLabel}: ${note}`;
  }
  message += `\n\n${labels.actionRequired}`;
  const encoded = encodeURIComponent(message);
  return phone
    ? `https://wa.me/${normalizePhoneNumber(phone)}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
}

export function generateQrUrl(equipmentId: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://vettrack.app";
  return `${origin}/equipment/${equipmentId}`;
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "…";
}
