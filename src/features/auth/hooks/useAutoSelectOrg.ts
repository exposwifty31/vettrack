import { useEffect, useRef } from "react";
import { useAuth as useClerkAuth, useOrganizationList } from "@clerk/clerk-react";
import { isCapacitorNative } from "@/lib/capacitor-runtime";

export function useAutoSelectOrg() {
  const { isSignedIn, isLoaded, orgId } = useClerkAuth();
  const { isLoaded: membershipsReady, userMemberships, setActive } = useOrganizationList({
    userMemberships: true,
  });
  // setActive may legitimately leave orgId unset for a while (or fail) — without
  // a one-shot guard the effect refires on every memberships revalidation and can
  // spam session touches / navigations.
  const attemptedRef = useRef(false);

  useEffect(() => {
    // Capacitor shell: clerk-js runs in non-standard-browser mode where
    // setActive's select_org session sync can trigger URL-based navigation —
    // on a fresh session (no active org) that loops the WebView forever.
    // The server never requires the Clerk org claim: tenant resolution falls
    // back to vt_users.clinic_id (server/middleware/auth.ts).
    if (isCapacitorNative()) return;
    if (attemptedRef.current) return;
    if (!isLoaded) return;
    if (!isSignedIn) return;
    if (!membershipsReady) return;
    if (userMemberships?.isLoading) return;
    if (orgId) return;

    const memberships = userMemberships?.data;
    if (!memberships?.length || !setActive) return;

    const firstOrgId = memberships[0]?.organization?.id;
    if (!firstOrgId) return;

    attemptedRef.current = true;
    void setActive({ organization: firstOrgId }).catch((err: unknown) => {
      console.error("[AutoSelectOrg] setActive failed", err);
    });
  }, [isLoaded, isSignedIn, membershipsReady, orgId, userMemberships?.data, userMemberships?.isLoading, setActive]);
}
