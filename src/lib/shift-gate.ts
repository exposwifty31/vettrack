/**
 * Client-side roster gate (UX policy only — the server's enforcement boundary is
 * requireEffectiveRole; there is NO server-side roster denial for scan/checkout).
 *
 * Callers pass canActOffShift = useExperience().can("equipment.actOffShift") and
 * OWN the pending state themselves (render a loading branch or early-return while
 * the shift query resolves) — this helper only decides the settled case.
 * A shift-query error defers to the server (use-active-shift isError contract).
 */
export function shouldBlockForShift(args: {
  hasActiveShift: boolean;
  shiftError: boolean;
  canActOffShift: boolean;
}): boolean {
  if (args.canActOffShift) return false;
  if (args.shiftError) return false;
  return !args.hasActiveShift;
}
