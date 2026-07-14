import { useRef, type KeyboardEvent } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDirection } from "@/hooks/useDirection";

/**
 * Roles selectable from the sign-up chips. These are literal `vt_users.role`
 * values (see `UserRole` in server/middleware/auth.ts) so a downstream
 * consumer of the requested-role tag never needs to remap them.
 */
export type SignupRequestedRole = "technician" | "vet";

const ROLE_OPTIONS: { role: SignupRequestedRole; label: () => string }[] = [
  { role: "technician", label: () => t.authPage.roleVetTech },
  { role: "vet", label: () => t.authPage.roleVeterinarian },
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
  const dir = useDirection();
  const chipRefs = useRef<Partial<Record<SignupRequestedRole, HTMLButtonElement | null>>>({});

  // WAI-ARIA radiogroup roving-focus pattern (mirrors the InventoryConsolePage
  // tablist): Arrow/Home/End move focus AND selection together, RTL-aware so
  // the "next" key matches the chips' visual reading direction.
  function onChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!onSelectRole) return;
    const forwardKey = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backwardKey = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    let nextIndex: number | null = null;
    if (event.key === forwardKey) nextIndex = (index + 1) % ROLE_OPTIONS.length;
    else if (event.key === backwardKey) nextIndex = (index - 1 + ROLE_OPTIONS.length) % ROLE_OPTIONS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = ROLE_OPTIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextRole = ROLE_OPTIONS[nextIndex].role;
    onSelectRole(nextRole);
    chipRefs.current[nextRole]?.focus();
  }

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
        {ROLE_OPTIONS.map(({ role, label }, index) => {
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
          // Roving tabindex: the selected chip is the single Tab stop; before
          // any selection, the first chip is the stop (matches native radiogroup default).
          const isTabStop = selectedRole ? isSelected : index === 0;
          return (
            <button
              key={role}
              ref={(el) => {
                chipRefs.current[role] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isTabStop ? 0 : -1}
              data-testid={`role-chip-${role}`}
              onClick={() => onSelectRole(role)}
              onKeyDown={(event) => onChipKeyDown(event, index)}
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
