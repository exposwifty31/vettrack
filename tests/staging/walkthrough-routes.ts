import type { StagingPersonaKey } from "./fixtures.js";

export type WalkthroughExpectation =
  | "loads"
  | "access_denied"
  | "redirect"
  | "auth_gate_pending"
  | "auth_gate_blocked";

export type WalkthroughRoute = {
  path: string;
  slug: string;
  /** Roles that should reach a loaded page (not admin-only denial). */
  allowedRoles: StagingPersonaKey[];
  /** When set, non-listed active roles expect inline access denied or empty admin surface. */
  adminOnly?: boolean;
  /** Student is redirected away (e.g. /meds → /equipment). */
  studentRedirect?: boolean;
  /** Menu-only routes: open hamburger before navigation. */
  menuOnly?: boolean;
  /** Skip for personas without clinical check-in when route needs it. */
  requiresClinical?: boolean;
};

/** Major app surfaces for staging walkthrough (staging-safe reads). */
export const WALKTHROUGH_ROUTES: WalkthroughRoute[] = [
  { path: "/home", slug: "home", allowedRoles: ["admin", "vet", "technician", "student"] },
  { path: "/equipment", slug: "equipment", allowedRoles: ["admin", "vet", "technician", "student"] },
  { path: "/alerts", slug: "alerts", allowedRoles: ["admin", "vet", "technician", "student"] },
  { path: "/my-equipment", slug: "my-equipment", allowedRoles: ["admin", "vet", "technician", "student"] },
  { path: "/rooms", slug: "rooms", allowedRoles: ["admin", "vet", "technician", "student"] },
  { path: "/appointments", slug: "appointments", allowedRoles: ["admin", "vet", "technician", "student"] },
  { path: "/patients", slug: "patients", allowedRoles: ["admin", "vet", "technician"], menuOnly: true },
  { path: "/display", slug: "display", allowedRoles: ["admin", "vet", "technician"], menuOnly: true },
  {
    path: "/meds",
    slug: "meds",
    allowedRoles: ["admin", "vet", "technician"],
    studentRedirect: true,
    menuOnly: true,
  },
  {
    path: "/pharmacy-forecast",
    slug: "pharmacy-forecast",
    allowedRoles: ["admin", "vet", "technician"],
    menuOnly: true,
  },
  {
    path: "/code-blue",
    slug: "code-blue",
    allowedRoles: ["admin", "vet", "technician"],
    requiresClinical: true,
  },
  { path: "/crash-cart", slug: "crash-cart", allowedRoles: ["admin", "vet", "technician"] },
  { path: "/shift-handover", slug: "shift-handover", allowedRoles: ["admin", "vet", "technician"] },
  { path: "/inventory", slug: "inventory", allowedRoles: ["admin", "vet", "technician"] },
  { path: "/analytics", slug: "analytics", allowedRoles: ["admin", "vet", "technician", "student"] },
  { path: "/billing", slug: "billing", allowedRoles: ["admin", "vet", "technician"] },
  { path: "/dashboard", slug: "dashboard", allowedRoles: ["admin", "vet", "technician"], menuOnly: true },
  { path: "/help", slug: "help", allowedRoles: ["admin", "vet", "technician", "student"], menuOnly: true },
  { path: "/settings", slug: "settings", allowedRoles: ["admin", "vet", "technician", "student"], menuOnly: true },
  {
    path: "/admin",
    slug: "admin",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
  {
    path: "/inventory-items",
    slug: "inventory-items",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
  {
    path: "/procurement",
    slug: "procurement",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
  {
    path: "/admin/shifts",
    slug: "admin-shifts",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
  {
    path: "/audit-log",
    slug: "audit-log",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
  {
    path: "/admin/ops-dashboard",
    slug: "admin-ops-dashboard",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
  {
    path: "/admin/medication-integrity",
    slug: "admin-medication-integrity",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
  {
    path: "/admin/code-blue-history",
    slug: "code-blue-history",
    allowedRoles: ["admin"],
    adminOnly: true,
    menuOnly: true,
  },
];

export function routesForPersona(key: StagingPersonaKey): WalkthroughRoute[] {
  if (key === "pending" || key === "blocked") return [];
  return WALKTHROUGH_ROUTES.filter((r) => {
    if (key === "student" && r.requiresClinical) return false;
    return true;
  });
}

export function expectedOutcome(
  route: WalkthroughRoute,
  persona: StagingPersonaKey,
): WalkthroughExpectation {
  if (persona === "pending") return "auth_gate_pending";
  if (persona === "blocked") return "auth_gate_blocked";
  if (route.adminOnly && persona !== "admin") return "access_denied";
  if (persona === "student" && route.studentRedirect) return "redirect";
  if (!route.allowedRoles.includes(persona)) return "access_denied";
  return "loads";
}
