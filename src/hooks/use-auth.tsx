import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { Shift, ShiftRole, UserRole } from "@/types";
import type { AuthoritySnapshot } from "../../shared/authority.js";
import { setAuthState, setCurrentClinicId } from "@/lib/auth-store";
import { isValidJwt, setClerkTokenGetter } from "@/lib/auth-fetch";
import { useUser, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { restoreOfflineSession, saveOfflineSession, clearOfflineSession } from "@/lib/offline-session";
import { authFetchUsersMe, authPostUsersSync } from "@/lib/api";
import { setAuthStateRef, clearHaltQueue, processQueue } from "@/lib/sync-engine";
import { maybeReportOfflineSyncTelemetry } from "@/lib/offline-sync-telemetry-reporter";
import { isOnline, safeReloadPage } from "@/lib/safe-browser";

export type UserStatus = "pending" | "active" | "blocked" | null;
export type AccessDeniedReason =
  | "MISSING_CLINIC_ID"
  | "DB_FALLBACK_DISABLED"
  | "TENANT_CONTEXT_MISSING"
  | "TENANT_MISMATCH"
  | "INSUFFICIENT_ROLE"
  | "ACCOUNT_DELETED"
  | "ACCOUNT_BLOCKED"
  | "ACCOUNT_PENDING_APPROVAL"
  | "AUTH_SYNC_FAILED"
  | null;

interface AuthState {
  userId: string | null; email: string | null; name: string | null;
  role: UserRole;
  secondaryRole: string | null;
  effectiveRole: UserRole | ShiftRole;
  roleSource: "shift" | "permanent";
  activeShift: Shift | null;
  resolvedAt: string | null;
  status: UserStatus;
  accessDeniedReason: AccessDeniedReason;
  isLoaded: boolean;
  isSignedIn: boolean; isAdmin: boolean; isOfflineSession: boolean;
  /** Server-derived — clinic-wide ER lock toggle (owner allowlist when configured). */
  canManageErMode: boolean;
  /** Phase 2A: advisory-only authority snapshot from /api/users/me. Not enforced. */
  authority?: AuthoritySnapshot;
}

interface AuthContextType extends AuthState {
  signOut: () => Promise<void>;
  refreshAuth: () => void;
}

interface SyncedUserResponse {
  id: string;
  clinicId?: string;
  email: string;
  name: string;
  role: UserRole;
  secondaryRole?: string | null;
  effectiveRole?: UserRole | ShiftRole;
  roleSource?: "shift" | "permanent";
  activeShift?: Shift | null;
  resolvedAt?: string;
  status: UserStatus;
  canManageErMode?: boolean;
  authority?: AuthoritySnapshot;
  error?: string;
  reason?: string;
  message?: string;
}

const AuthContext = createContext<AuthContextType>({
  userId: null, email: null, name: null, role: "technician", secondaryRole: null,
  effectiveRole: "technician", roleSource: "permanent", activeShift: null, resolvedAt: null, status: null, accessDeniedReason: null,
  isLoaded: false, isSignedIn: false, isAdmin: false, isOfflineSession: false,
  canManageErMode: false,
  signOut: async () => {},
  refreshAuth: () => {},
});

function DevAuthProviderInner({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const offlineSnapshot = typeof window !== "undefined" && !isOnline()
    ? restoreOfflineSession()
    : null;

  const [state, setState] = useState<AuthState>(() => {
    if (offlineSnapshot) {
      setAuthState({
        userId: offlineSnapshot.userId,
        email: offlineSnapshot.email,
        name: offlineSnapshot.name,
        bearerToken: offlineSnapshot.token,
      });
      setCurrentClinicId(offlineSnapshot.clinicId);

      return {
        userId: offlineSnapshot.userId,
        email: offlineSnapshot.email,
        name: offlineSnapshot.name,
        role: offlineSnapshot.role as UserRole,
        secondaryRole: null,
        effectiveRole: offlineSnapshot.role as UserRole,
        roleSource: "permanent",
        activeShift: null,
        resolvedAt: null,
        status: offlineSnapshot.status as UserStatus,
        accessDeniedReason: null,
        isLoaded: true,
        isSignedIn: true,
        isAdmin: offlineSnapshot.role === "admin",
        isOfflineSession: true,
        canManageErMode: false,
      };
    }

    return {
      userId: null, email: null, name: null, role: "technician", secondaryRole: null,
      effectiveRole: "technician", roleSource: "permanent", activeShift: null, resolvedAt: null, status: null, accessDeniedReason: null,
      isLoaded: false, isSignedIn: false, isAdmin: false, isOfflineSession: false,
      canManageErMode: false,
    };
  });
  const [authRefreshNonce, setAuthRefreshNonce] = useState(0);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setAuthStateRef(() => ({
      isSignedIn: stateRef.current.isSignedIn,
      isOfflineSession: stateRef.current.isOfflineSession,
    }));
    return () => {
      setAuthStateRef(() => null);
    };
  }, []);

  const signOut = useCallback(async () => {
    clearOfflineSession();
    clearHaltQueue();
    setCurrentClinicId();
    setAuthState({ userId: "", email: "", name: "", bearerToken: null });
    queryClient.clear();
    setState({
      userId: null, email: null, name: null, role: "technician", secondaryRole: null,
      effectiveRole: "technician", roleSource: "permanent", activeShift: null, resolvedAt: null, status: null, accessDeniedReason: null,
      isLoaded: true, isSignedIn: false, isAdmin: false, isOfflineSession: false,
      canManageErMode: false,
    });
    if (typeof window !== "undefined") {
      safeReloadPage({ minIntervalMs: 1000 });
    }
  }, [queryClient]);

  const refreshAuth = useCallback(() => {
    setState((prev) => ({ ...prev, isLoaded: false }));
    setAuthRefreshNonce((v) => v + 1);
  }, []);

  useEffect(() => {
    setClerkTokenGetter(null);
    return () => {
      setClerkTokenGetter(null);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function syncDevSession() {
      try {
        const res = await authFetchUsersMe({ signal: controller.signal });
        const data = await res.json().catch(() => ({} as Partial<SyncedUserResponse>));
        if (!res.ok) {
          throw new Error(`DEV_AUTH_SYNC_FAILED_${res.status}`);
        }

        const dbUserId = typeof data.id === "string" ? data.id : "";
        const role = (data.role ?? "technician") as UserRole;
        const status = (data.status ?? "active") as UserStatus;
        const resolvedEmail = typeof data.email === "string" ? data.email : "";
        const resolvedName = typeof data.name === "string" ? data.name : "";
        if (!dbUserId) {
          throw new Error("Missing DB user ID in /api/users/me response");
        }

        setAuthState({
          userId: dbUserId,
          email: resolvedEmail,
          name: resolvedName,
          bearerToken: null,
        });
        setCurrentClinicId(
          typeof data.clinicId === "string" ? data.clinicId : undefined,
        );

        clearHaltQueue();
        saveOfflineSession({
          userId: dbUserId,
          email: resolvedEmail,
          name: resolvedName,
          role,
          status: status ?? "active",
          token: "",
          clinicId: typeof data.clinicId === "string" ? data.clinicId : undefined,
        });

        setState({
          userId: dbUserId,
          email: resolvedEmail,
          name: resolvedName,
          role,
          secondaryRole: (data.secondaryRole ?? null) as string | null,
          effectiveRole: (data.effectiveRole ?? role) as UserRole | ShiftRole,
          roleSource: data.roleSource ?? "permanent",
          activeShift: data.activeShift ?? null,
          resolvedAt: data.resolvedAt ?? null,
          status,
          accessDeniedReason: null,
          isLoaded: true,
          isSignedIn: true,
          isAdmin: role === "admin" || (data.secondaryRole ?? null) === "admin",
          isOfflineSession: false,
          canManageErMode: data.canManageErMode === true,
          authority: data.authority,
        });

        processQueue().catch(() => {});
        void maybeReportOfflineSyncTelemetry({ force: true });
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("Dev auth sync failed:", err);
        clearHaltQueue();
        setCurrentClinicId();
        setAuthState({ userId: "", email: "", name: "", bearerToken: null });
        setState({
          userId: null, email: null, name: null, role: "technician", secondaryRole: null,
          effectiveRole: "technician", roleSource: "permanent", activeShift: null, resolvedAt: null, status: null, accessDeniedReason: null,
          isLoaded: true, isSignedIn: false, isAdmin: false, isOfflineSession: false,
          canManageErMode: false,
        });
      }
    }

    syncDevSession();
    return () => controller.abort();
  }, [authRefreshNonce]);

  const value = useMemo(() => ({ ...state, signOut, refreshAuth }), [state, signOut, refreshAuth]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkModeAuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken, signOut: clerkSignOut } = useClerkAuth();
  const queryClient = useQueryClient();

  const offlineSnapshot = typeof window !== "undefined" && !isOnline()
    ? restoreOfflineSession()
    : null;

  const [state, setState] = useState<AuthState>(() => {
    if (offlineSnapshot) {
      setAuthState({
        userId: offlineSnapshot.userId,
        email: offlineSnapshot.email,
        name: offlineSnapshot.name,
        bearerToken: offlineSnapshot.token,
      });
      setCurrentClinicId(offlineSnapshot.clinicId);

      return {
        userId: offlineSnapshot.userId,
        email: offlineSnapshot.email,
        name: offlineSnapshot.name,
        role: offlineSnapshot.role as UserRole,
        secondaryRole: null,
        effectiveRole: offlineSnapshot.role as UserRole,
        roleSource: "permanent",
        activeShift: null,
        resolvedAt: null,
        status: offlineSnapshot.status as UserStatus,
        accessDeniedReason: null,
        isLoaded: true,
        isSignedIn: true,
        isAdmin: offlineSnapshot.role === "admin",
        isOfflineSession: true,
        canManageErMode: false,
      };
    }

    return {
      userId: null, email: null, name: null, role: "technician", secondaryRole: null,
      effectiveRole: "technician", roleSource: "permanent", activeShift: null, resolvedAt: null, status: null, accessDeniedReason: null,
      isLoaded: false, isSignedIn: false, isAdmin: false, isOfflineSession: false,
      canManageErMode: false,
    };
  });
  const [authRefreshNonce, setAuthRefreshNonce] = useState(0);
  const stateRef = useRef(state);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    if (!isSignedIn) {
      setClerkTokenGetter(null);
      return;
    }
    setClerkTokenGetter(async () => {
      const token = await getTokenRef.current();
      return typeof token === "string" ? token : null;
    });
    return () => {
      setClerkTokenGetter(null);
    };
  }, [getToken, isSignedIn]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setAuthStateRef(() => ({
      isSignedIn: stateRef.current.isSignedIn,
      isOfflineSession: stateRef.current.isOfflineSession,
    }));
    return () => {
      setAuthStateRef(() => null);
    };
  }, []);

  const signOut = useCallback(async () => {
    clearOfflineSession();
    clearHaltQueue();
    setCurrentClinicId();
    setAuthState({ userId: "", email: "", name: "", bearerToken: null });
    queryClient.clear();
    await clerkSignOut({ redirectUrl: "/" });
  }, [queryClient, clerkSignOut]);

  const refreshAuth = useCallback(() => {
    setState((prev) => ({ ...prev, isLoaded: false }));
    setAuthRefreshNonce((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !user) {
      if (stateRef.current.isLoaded && !stateRef.current.isSignedIn) {
        return;
      }
      clearHaltQueue();
      setCurrentClinicId();
      setAuthState({ userId: "", email: "", name: "", bearerToken: null });
      setState({
        userId: null, email: null, name: null, role: "technician", secondaryRole: null,
        effectiveRole: "technician", roleSource: "permanent", activeShift: null, resolvedAt: null, status: null, accessDeniedReason: null,
        isLoaded: true, isSignedIn: false, isAdmin: false, isOfflineSession: false,
        canManageErMode: false,
      });
      return;
    }

    const syncAbort = new AbortController();

    async function syncSession() {
      setState((s) => (s.isLoaded && !s.isSignedIn ? { ...s, isLoaded: false } : s));
      const rawToken = await getTokenRef.current();
      const token = typeof rawToken === "string" ? rawToken.trim() : "";
      const email = user?.primaryEmailAddress?.emailAddress || "";
      const name = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
      const clerkId = user?.id || "";
      setAuthState({
        userId: "",
        email,
        name,
        bearerToken: token || null,
      });

      const headers = {
        "Content-Type": "application/json",
        ...(isValidJwt(token) ? { "Authorization": `Bearer ${token}` } : {}),
      };
      const timeoutId = setTimeout(() => syncAbort.abort(), 10000);

      try {
        // 1. Try fetching the existing user
        let res = await authFetchUsersMe({ headers, signal: syncAbort.signal });

        // 2. Sync/provision only when user is missing/unauthorized.
        // Avoid calling /sync on transient failures such as 429.
        if (!res.ok && (res.status === 401 || res.status === 404)) {
          res = await authPostUsersSync(
            { clerkId, email, name },
            { headers, signal: syncAbort.signal },
          );
        }

        const data = await res.json().catch(() => ({} as Partial<SyncedUserResponse>));
        
        if (res.ok) {
          const dbUserId = typeof data.id === "string" ? data.id : "";
          const role = (data.role ?? "technician") as UserRole;
          const status = (data.status ?? null) as UserStatus;
          const resolvedEmail = typeof data.email === "string" ? data.email : email;
          const resolvedName = typeof data.name === "string" ? data.name : name;
          if (!dbUserId) {
            throw new Error("Missing DB user ID in /api/users/me response");
          }

          setAuthState({
            userId: dbUserId,
            email: resolvedEmail,
            name: resolvedName,
            bearerToken: token || null,
          });
          setCurrentClinicId(
            typeof data.clinicId === "string" ? data.clinicId : undefined,
          );

          clearHaltQueue();
          saveOfflineSession({
            userId: dbUserId,
            email: resolvedEmail,
            name: resolvedName,
            role,
            status: status ?? "active",
            token: token || "",
            clinicId: typeof data.clinicId === "string" ? data.clinicId : undefined,
          });

          setState({
            userId: dbUserId,
            email: resolvedEmail,
            name: resolvedName,
            role,
            secondaryRole: (data.secondaryRole ?? null) as string | null,
            effectiveRole: (data.effectiveRole ?? role) as UserRole | ShiftRole,
            roleSource: data.roleSource ?? "permanent",
            activeShift: data.activeShift ?? null,
            resolvedAt: data.resolvedAt ?? null,
            status,
            accessDeniedReason: null,
            isLoaded: true, isSignedIn: true,
            isAdmin: role === "admin" || (data.secondaryRole ?? null) === "admin",
            isOfflineSession: false,
            canManageErMode: data.canManageErMode === true,
            authority: data.authority,
          });

          processQueue().catch(() => {});
          void maybeReportOfflineSyncTelemetry({ force: true });
        } else if (res.status === 403) {
          clearHaltQueue();
          const reason = (typeof data.reason === "string" ? data.reason : null) as AccessDeniedReason;
          const resolvedStatus: UserStatus =
            reason === "ACCOUNT_BLOCKED"
              ? "blocked"
              : reason === "ACCOUNT_PENDING_APPROVAL"
                ? "pending"
                : null;
          setState(s => ({
            ...s,
            isLoaded: true,
            isSignedIn: true,
            status: resolvedStatus,
            accessDeniedReason: reason,
            isOfflineSession: false,
            canManageErMode: false,
          }));
        } else if (res.status === 401) {
          // Clerk reports signed-in, but backend rejected auth token/session.
          // Clear Clerk session so <SignIn> cannot auto-redirect to /home (H1 loop).
          console.error("Auth sync unauthorized:", data);
          clearHaltQueue();
          setCurrentClinicId();
          setAuthState({ userId: "", email: "", name: "", bearerToken: null });
          setState({
            userId: null, email: null, name: null, role: "technician", secondaryRole: null,
            effectiveRole: "technician", roleSource: "permanent", activeShift: null, resolvedAt: null, status: null, accessDeniedReason: null,
            isLoaded: true, isSignedIn: false, isAdmin: false, isOfflineSession: false,
            canManageErMode: false,
          });
          try {
            await clerkSignOut({ redirectUrl: "/signin" });
          } catch (signOutErr) {
            console.error("Clerk sign-out after auth sync 401 failed:", signOutErr);
          }
        } else {
          // Transient server errors must not masquerade as pending approval (#379).
          console.error("Auth sync failed with unexpected status:", res.status, data);
          clearHaltQueue();
          setState((s) => ({
            ...s,
            isLoaded: true,
            isSignedIn: true,
            status: null,
            accessDeniedReason: "AUTH_SYNC_FAILED",
            isOfflineSession: false,
            canManageErMode: false,
          }));
        }
      } catch (err) {
        if (syncAbort.signal.aborted) return;
        console.error("Auth Sync Error:", err);
        clearHaltQueue();
        setState((s) => ({
          ...s,
          isLoaded: true,
          isSignedIn: true,
          status: null,
          accessDeniedReason: "AUTH_SYNC_FAILED",
          isOfflineSession: false,
          canManageErMode: false,
        }));
      } finally {
        clearTimeout(timeoutId);
      }
    }

    syncSession();
    return () => {
      syncAbort.abort();
    };
  }, [isLoaded, isSignedIn, user?.id, user?.primaryEmailAddress?.emailAddress, user?.firstName, user?.lastName, authRefreshNonce, clerkSignOut]);

  const value = useMemo(() => ({ ...state, signOut, refreshAuth }), [state, signOut, refreshAuth]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function ClerkAuthProviderInner({ children }: { children: ReactNode }) {
  if (Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)) {
    return <ClerkModeAuthProvider>{children}</ClerkModeAuthProvider>;
  }
  return <DevAuthProviderInner>{children}</DevAuthProviderInner>;
}

export const useAuth = () => useContext(AuthContext);
