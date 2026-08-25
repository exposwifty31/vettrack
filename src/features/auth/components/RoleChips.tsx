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
  selectedRole: SignupRequestedRole | null;
  onSelectRole: (role: SignupRequestedRole) => void;
}

/** Sign-up only: single-select role control (radiogroup + RTL roving focus). */
export function RoleChips({ selectedRole, onSelectRole }: RoleChipsProps) {
  const dir = useDirection();
  const chipRefs = useRef<Partial<Record<SignupRequestedRole, HTMLButtonElement | null>>>({});

  // WAI-ARIA radiogroup roving-focus pattern (mirrors the InventoryConsolePage
  // tablist): Arrow/Home/End move focus AND selection together, RTL-aware so
  // the "next" key matches the chips' visual reading direction.
  function onChipKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
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
    <div className="mb-5 flex flex-col items-center gap-2">
      <span className="vt-text-xs font-semibold uppercase tracking-widest text-ivory-text3">
        {t.authPage.roleSelectLabel}
      </span>
      <div
        className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center"
        role="radiogroup"
        aria-label={t.authPage.roleSelectLabel}
      >
        {ROLE_OPTIONS.map(({ role, label }, index) => {
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
                "inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-4 vt-text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-surface",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  // An unselected chip sits directly on the page, where
                  // `ivory-border` reaches only 1.36:1 — below the 3:1 WCAG
                  // 1.4.11 asks of a control's boundary, and the fill is white
                  // on near-white, so the outline is the only thing that says
                  // "tappable". `borderStrong` is the tier for that position.
                  : "border-ivory-borderStrong bg-ivory-surface text-ivory-text hover:bg-muted/50",
              )}
            >
              {label()}
            </button>
          );
        })}
      </div>
      <p className="vt-text-xs max-w-[16rem] text-center text-ivory-text3 text-pretty">
        {t.authPage.roleSelectHint}
      </p>
    </div>
  );
}
