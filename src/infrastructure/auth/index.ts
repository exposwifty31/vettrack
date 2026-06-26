/**
 * Auth adapter barrel.
 * The useAuth hook and auth-store utilities are the canonical auth surface.
 * Re-export from here so features can import from @/infrastructure/auth.
 */
export { useAuth } from "@/hooks/use-auth";
export { getCurrentClinicId, getCurrentUserId } from "@/lib/auth-store";
