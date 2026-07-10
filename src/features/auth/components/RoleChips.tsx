import { t } from "@/lib/i18n";

/**
 * Informational role chips shown on sign-in / sign-up — the roles VetTrack serves,
 * NOT a selectable control. A user's actual role is assigned by their clinic admin
 * on approval, so no chip is "selected" or submitted. Shared by both auth pages so
 * the markup and framing can't drift.
 */
export function RoleChips() {
  return (
    <div className="mb-6 flex flex-col items-center gap-2">
      <span className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
        {t.authPage.roleLabel}
      </span>
      <div className="flex flex-wrap justify-center gap-2">
        {[t.authPage.roleVetTech, t.authPage.roleVeterinarian, t.authPage.roleStudent].map((label) => (
          <span
            key={label}
            className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3.5 text-xs font-semibold text-foreground"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
