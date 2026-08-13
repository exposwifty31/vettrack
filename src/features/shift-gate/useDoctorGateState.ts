import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

/** Snooze contract (spec 2026-08-13): epoch-ms string; the "No" answer = now + 8 h. */
export const DOCTOR_GATE_SNOOZE_KEY = "vt_doctor_gate_snooze_until";
const SNOOZE_MS = 8 * 3_600_000;

function readSnoozeUntil(): number {
  try {
    const raw = localStorage.getItem(DOCTOR_GATE_SNOOZE_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

/**
 * Doctor shift gate visibility state. The gate shows only when ALL hold:
 * auth resolved to a vet-role user, no open clinical check-in, and no
 * un-expired snooze. Queries stay disabled outside that path so
 * technicians/admins never issue the check-in lookup.
 */
export function useDoctorGateState() {
  const { role, isLoaded, isSignedIn } = useAuth();
  const [snoozedUntil, setSnoozedUntil] = useState<number>(() => readSnoozeUntil());

  const snoozed = Date.now() < snoozedUntil;
  const gateEnabled = isLoaded && isSignedIn && role === "vet" && !snoozed;

  const activeQuery = useQuery({
    queryKey: ["/api/clinical-check-in/me/active"],
    queryFn: () => api.checkIn.active(),
    enabled: gateEnabled,
  });

  const hasNoActiveCheckIn = activeQuery.isSuccess && activeQuery.data.active === null;

  // seniorDoctorEligible lives on /api/users/me (Task 6) — useAuth does not
  // carry it, so fetch it only once the gate is actually going to show.
  const meQuery = useQuery({
    queryKey: ["/api/users/me", "doctor-gate"],
    queryFn: () => api.users.me(),
    enabled: gateEnabled && hasNoActiveCheckIn,
  });

  const snooze = useCallback(() => {
    const until = Date.now() + SNOOZE_MS;
    try {
      localStorage.setItem(DOCTOR_GATE_SNOOZE_KEY, String(until));
    } catch {
      // Storage unavailable (private mode) — fall back to in-memory snooze.
    }
    setSnoozedUntil(until);
  }, []);

  // Hold the popup until the eligibility lookup settles — otherwise an
  // eligible senior could race through the team step before the senior
  // toggle appears and check in as non-senior. An error settles fail-open
  // (gate shows, senior option absent).
  const eligibilitySettled = meQuery.isSuccess || meQuery.isError;

  return {
    shouldShow: gateEnabled && hasNoActiveCheckIn && eligibilitySettled,
    seniorDoctorEligible: meQuery.data?.seniorDoctorEligible === true,
    snooze,
  };
}
