import { useState } from "react";
import { UserCog } from "lucide-react";
import { SettingsSectionHeader, SettingsSelect } from "@/components/settings-controls";
import {
  DEV_OVERRIDE_ROLES,
  DEV_ROLE_OVERRIDE_KEY,
  getDevRoleOverride,
  isDevBypassBuild,
  isDevOverrideRole,
} from "@/lib/auth-fetch";

const DEFAULT_OPTION = "__default__";

/**
 * Hint for the two archetypes exercised via a proxy server role: the server's
 * `normalizeUserRole` collapses `lead_technician`/`vet_tech` → `student`, so the
 * "lead" archetype is tested with `senior_technician` and "tech" with `technician`.
 */
const ROLE_HINT: Partial<Record<string, string>> = {
  senior_technician: "senior_technician · lead archetype",
  technician: "technician · tech archetype",
};

/**
 * Dev-only role impersonation switcher. Writes `vt:devRole` to localStorage;
 * `authFetch` reads it and attaches `x-dev-role-override` to every `/api/` call.
 *
 * Renders nothing in Clerk builds (production) — dev-bypass only. Copy is left
 * as plain English on purpose: this surface is unreachable in any shipped build,
 * so it is dev tooling, not user-facing product copy that would require i18n keys.
 */
export function DevRoleSwitcher() {
  const [role, setRole] = useState<string>(() => getDevRoleOverride() ?? DEFAULT_OPTION);

  // Hooks run unconditionally above; gate the render below (Rules of Hooks).
  if (!isDevBypassBuild()) return null;

  const options = [
    { value: DEFAULT_OPTION, label: "Default · dev admin" },
    ...DEV_OVERRIDE_ROLES.map((r) => ({ value: r, label: ROLE_HINT[r] ?? r })),
  ];

  const handleChange = (next: string) => {
    try {
      if (next === DEFAULT_OPTION) {
        globalThis.localStorage?.removeItem(DEV_ROLE_OVERRIDE_KEY);
      } else if (isDevOverrideRole(next)) {
        globalThis.localStorage?.setItem(DEV_ROLE_OVERRIDE_KEY, next);
      }
    } catch {
      /* storage denied — nothing to persist */
    }
    setRole(next);
    // Re-fetch the session under the new role. The dev user row is rewritten
    // server-side (ensureDevUserRecord), so a full reload is the clean path.
    globalThis.location?.reload();
  };

  return (
    <section className="space-y-2" data-testid="dev-role-switcher-section">
      <SettingsSectionHeader label="Developer · role override (dev-bypass only)" />
      <SettingsSelect
        icon={<UserCog className="h-5 w-5" />}
        label="Impersonate role"
        description="Sets x-dev-role-override on every API call, then reloads. Inert in Clerk builds."
        value={role}
        options={options}
        onValueChange={handleChange}
        data-testid="dev-role-switcher"
      />
    </section>
  );
}
