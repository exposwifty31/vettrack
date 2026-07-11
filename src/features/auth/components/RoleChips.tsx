import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Roles selectable from the sign-up chips. These are literal `vt_users.role`
 * values (see `UserRole` in server/middleware/auth.ts) so a downstream
 * consumer of the requested-role tag never needs to remap them.
 */
export type SignupRequestedRole = "technician" | "vet" | "student";

const ROLE_OPTIONS: { role: SignupRequestedRole; label: () => string }[] = [
  { role: "technician", label: () => t.authPage.roleVetTech },
  { role: "vet", label: () => t.authPage.roleVeterinarian },
  { role: "student", label: () => t.authPage.roleStudent },
];

interface RoleChipsProps {
  /**
   * When provided (together with `onSelectRole`), the chips become a
   * single-select control (sign-up: pre-select the role to request).
   * Omit both props for the informational, non-interactive display used
   * on sign-in — the roles VetTrack serves, not a selectable control.
   */
  selectedRole?: SignupRequestedRole | null;
  onSelectRole?: (role: SignupRequestedRole) => void;
}

export function RoleChips({ selectedRole, onSelectRole }: RoleChipsProps = {}) {
  const interactive = typeof onSelectRole === "function";

  return (
    <div className="mb-6 flex flex-col items-center gap-2">
      <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
        {interactive ? t.authPage.roleSelectLabel : t.authPage.roleLabel}
      </span>
      <div
        className="flex flex-wrap justify-center gap-2"
        role={interactive ? "radiogroup" : undefined}
        aria-label={interactive ? t.authPage.roleSelectLabel : undefined}
      >
        {ROLE_OPTIONS.map(({ role, label }) => {
          if (!interactive) {
            return (
              <span
                key={role}
                className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-foreground"
              >
                {label()}
              </span>
            );
          }

          const isSelected = selectedRole === role;
          return (
            <button
              key={role}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-testid={`role-chip-${role}`}
              onClick={() => onSelectRole(role)}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {label()}
            </button>
          );
        })}
      </div>
      {interactive && (
        <p className="text-center text-[11px] text-muted-foreground max-w-[15rem]">
          {t.authPage.roleSelectHint}
        </p>
      )}
    </div>
  );
}
