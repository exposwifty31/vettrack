import type { Equipment } from "@/types";
import { getEquipmentDisplayName } from "@/lib/equipment-display";
import { t } from "@/lib/i18n";

const MISSING_HOURS = 24;
const MISSING_COST_DEFAULT = 500;
const ISSUE_COST_DEFAULT = 75;

export interface DashboardCounts {
  available: number;
  inUse: number;
  issues: number;
  missing: number;
}

export interface CriticalItem {
  id: string;
  name: string;
  reason: string;
  location?: string | null;
  status: string;
}

export interface UserEquipmentGroup {
  userId: string;
  userEmail: string;
  items: Equipment[];
}

export interface LocationGroup {
  location: string;
  count: number;
}

export interface CostEstimate {
  missingCost: number;
  issueCost: number;
  total: number;
}

export function isEquipmentMissing(eq: Equipment): boolean {
  if (eq.checkedOutById) return false;
  if (!eq.lastSeen) return true;
  const hoursSinceLastSeen =
    (Date.now() - new Date(eq.lastSeen).getTime()) / (1000 * 60 * 60);
  return hoursSinceLastSeen > MISSING_HOURS;
}

export function isEquipmentAvailable(eq: Equipment): boolean {
  return eq.status === "ok" && !eq.checkedOutById;
}

export function isEquipmentInUse(eq: Equipment): boolean {
  return !!eq.checkedOutById;
}

export function isEquipmentIssue(eq: Equipment): boolean {
  return eq.status === "issue";
}

export function computeDashboardCounts(equipment: Equipment[]): DashboardCounts {
  let available = 0;
  let inUse = 0;
  let issues = 0;
  let missing = 0;

  for (const eq of equipment) {
    if (isEquipmentAvailable(eq)) available++;
    if (isEquipmentInUse(eq)) inUse++;
    if (isEquipmentIssue(eq)) issues++;
    if (isEquipmentMissing(eq)) missing++;
  }

  return { available, inUse, issues, missing };
}

export function computeCriticalItems(equipment: Equipment[]): CriticalItem[] {
  const items: CriticalItem[] = [];

  for (const eq of equipment) {
    if (isEquipmentIssue(eq)) {
      items.push({
        id: eq.id,
        name: getEquipmentDisplayName(eq),
        reason: t.managementDashboardPage.criticalReasonActiveIssue,
        location: eq.location,
        status: "issue",
      });
    } else if (isEquipmentMissing(eq)) {
      items.push({
        id: eq.id,
        name: getEquipmentDisplayName(eq),
        reason: eq.lastSeen
          ? t.managementDashboardPage.criticalReasonNotSeen24h
          : t.managementDashboardPage.criticalReasonNeverScanned,
        location: eq.location,
        status: "missing",
      });
    }
  }

  return items;
}

export function computeUserGroups(equipment: Equipment[]): UserEquipmentGroup[] {
  const map = new Map<string, UserEquipmentGroup>();

  for (const eq of equipment) {
    if (!eq.checkedOutById) continue;
    const key = eq.checkedOutById;
    if (!map.has(key)) {
      map.set(key, {
        userId: eq.checkedOutById,
        userEmail: eq.checkedOutByEmail || "Unknown user",
        items: [],
      });
    }
    map.get(key)!.items.push(eq);
  }

  return Array.from(map.values()).sort((a, b) =>
    b.items.length - a.items.length
  );
}

export function computeLocationGroups(equipment: Equipment[]): LocationGroup[] {
  const map = new Map<string, number>();

  for (const eq of equipment) {
    const loc = eq.location || "Unknown";
    map.set(loc, (map.get(loc) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeCostEstimate(equipment: Equipment[]): CostEstimate {
  let missingCost = 0;
  let issueCost = 0;

  for (const eq of equipment) {
    if (isEquipmentMissing(eq)) {
      missingCost += MISSING_COST_DEFAULT;
    }
    if (isEquipmentIssue(eq)) {
      issueCost += ISSUE_COST_DEFAULT;
    }
  }

  return { missingCost, issueCost, total: missingCost + issueCost };
}

export function computeOperationalPercent(equipment: Equipment[]): number {
  if (equipment.length === 0) return 100;
  const counts = computeDashboardCounts(equipment);
  const operational = counts.available + counts.inUse;
  return Math.round((operational / equipment.length) * 100);
}

export interface DashboardData {
  counts: DashboardCounts;
  criticalItems: CriticalItem[];
  userGroups: UserEquipmentGroup[];
  locationGroups: LocationGroup[];
  costEstimate: CostEstimate;
  operationalPercent: number;
}

export function computeDashboardData(equipment: Equipment[]): DashboardData {
  let available = 0;
  let inUse = 0;
  let issues = 0;
  let missing = 0;
  let missingCost = 0;
  let issueCost = 0;

  const criticalItems: CriticalItem[] = [];
  const userMap = new Map<string, UserEquipmentGroup>();
  const locationMap = new Map<string, number>();

  const now = Date.now();
  const MISSING_MS = MISSING_HOURS * 60 * 60 * 1000;

  for (const eq of equipment) {
    const isInUse = !!eq.checkedOutById;
    const isAvailable = eq.status === "ok" && !isInUse;
    const hasIssue = eq.status === "issue";
    const isMissing =
      !isInUse &&
      (!eq.lastSeen || now - new Date(eq.lastSeen).getTime() > MISSING_MS);

    if (isAvailable) available++;
    if (isInUse) inUse++;
    if (hasIssue) issues++;
    if (isMissing) missing++;

    if (hasIssue) {
      issueCost += ISSUE_COST_DEFAULT;
      criticalItems.push({
        id: eq.id,
        name: getEquipmentDisplayName(eq),
        reason: t.managementDashboardPage.criticalReasonActiveIssue,
        location: eq.location,
        status: "issue",
      });
    } else if (isMissing) {
      missingCost += MISSING_COST_DEFAULT;
      criticalItems.push({
        id: eq.id,
        name: getEquipmentDisplayName(eq),
        reason: eq.lastSeen
          ? t.managementDashboardPage.criticalReasonNotSeen24h
          : t.managementDashboardPage.criticalReasonNeverScanned,
        location: eq.location,
        status: "missing",
      });
    }

    if (isInUse) {
      const key = eq.checkedOutById!;
      if (!userMap.has(key)) {
        userMap.set(key, {
          userId: key,
          userEmail: eq.checkedOutByEmail || "Unknown user",
          items: [],
        });
      }
      userMap.get(key)!.items.push(eq);
    }

    const loc = eq.location || "Unknown";
    locationMap.set(loc, (locationMap.get(loc) ?? 0) + 1);
  }

  const userGroups = Array.from(userMap.values()).sort(
    (a, b) => b.items.length - a.items.length
  );
  const locationGroups = Array.from(locationMap.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count);

  const counts: DashboardCounts = { available, inUse, issues, missing };
  const operational = available + inUse;
  const operationalPercent =
    equipment.length === 0
      ? 100
      : Math.round((operational / equipment.length) * 100);
  const costEstimate: CostEstimate = {
    missingCost,
    issueCost,
    total: missingCost + issueCost,
  };

  return {
    counts,
    criticalItems,
    userGroups,
    locationGroups,
    costEstimate,
    operationalPercent,
  };
}
