// Single source of truth for the WEB MANAGEMENT CONSOLE navigation (Phase 6 / B2).
//
// Separate from `nav-model.ts` (the operational app nav) and untouched by the
// native shell (`native-nav-model.ts`). Rendered by IconSidebar/Topbar as its own
// capability-gated section for `management.web` users (admin full; lead read-only —
// `writeCap` affordances need `management.webWrite`, which lead does NOT have).
//
// This is UX shaping only; the server stays the enforcement boundary. Note (Q1):
// the console read endpoints are `requireAdmin` today, so a lead holding
// `management.web` will 403 on data fetches until server access is relaxed in a
// later phase — the module pages render an honest "pending server enablement"
// state rather than a broken fetch.
import { can, type Capability, type RoleExperience } from "@/lib/roles/experience-model";

export type WebManagementGroup = "administration" | "operations";

export interface WebManagementNavNode {
  id: string;
  /** i18n key under `nav.*`, resolved at render (navLabel strips the `nav.` prefix). Never a literal. */
  labelKey: string;
  href: string;
  /** lucide-react icon NAME — must also be added to the consumer's ICON_MAP + import (unmapped ⇒ dropped). */
  icon: string;
  group: WebManagementGroup;
  /** Visibility capability — admin + lead + secondary-admin. */
  reach: Extract<Capability, "management.web">;
  /** Page-level write-affordance capability (admin / secondary-admin only). Absent = read-only module. */
  writeCap?: Extract<Capability, "management.webWrite">;
}

export const WEB_MANAGEMENT_NAV: WebManagementNavNode[] = [
  {
    id: "mgmt-integrations",
    labelKey: "nav.integrations",
    href: "/admin/integrations",
    icon: "Cable",
    group: "administration",
    reach: "management.web",
    writeCap: "management.webWrite",
  },
  {
    id: "mgmt-webhooks",
    labelKey: "nav.webhooks",
    href: "/admin/webhooks",
    icon: "Webhook",
    group: "administration",
    reach: "management.web",
    writeCap: "management.webWrite",
  },
  {
    id: "mgmt-notifications",
    labelKey: "nav.notifications",
    href: "/admin/notifications",
    icon: "BellRing",
    group: "administration",
    reach: "management.web",
    writeCap: "management.webWrite",
  },
  {
    id: "mgmt-rfid",
    labelKey: "nav.rfidReaders",
    href: "/admin/rfid-readers",
    icon: "RadioTower",
    group: "administration",
    reach: "management.web",
  },
  {
    id: "mgmt-ops-health",
    labelKey: "nav.opsHealth",
    href: "/ops/health",
    icon: "Activity",
    group: "operations",
    reach: "management.web",
  },
];

/** Flattened href list (active-state + dead-link tests; mirrors NAV_HREFS). */
export const WEB_MANAGEMENT_HREFS: string[] = WEB_MANAGEMENT_NAV.map((n) => n.href);

/**
 * The management nav visible to a given experience. All-or-nothing on
 * `management.web` (every node requires it); the consumer groups by `group`.
 * Mirrors the `filterAdminNav` pattern from the operational nav.
 */
export function visibleWebManagementNav(experience: RoleExperience): WebManagementNavNode[] {
  return can(experience, "management.web") ? WEB_MANAGEMENT_NAV : [];
}
