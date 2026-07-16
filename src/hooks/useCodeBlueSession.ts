// src/hooks/useCodeBlueSession.ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { OfflineEmergencyMutationBlockedError } from "@/lib/offline-policy";
import { subscribeKeepalive } from "@/lib/realtime";
import { toast } from "sonner";
import { t } from "@/lib/i18n";

export interface CodeBlueLogEntry {
  id: string;
  sessionId: string;
  elapsedMs: number;
  label: string;
  category: "equipment" | "note";
  equipmentId?: string | null;
  loggedByUserId: string;
  loggedByName: string;
  createdAt: string;
}

export interface CodeBlueSession {
  id: string;
  clinicId: string;
  startedAt: string;
  startedBy: string;
  startedByName: string;
  managerUserId: string;
  managerUserName: string;
  status: "active" | "ended";
  outcome?: string | null;
  preCheckPassed?: boolean | null;
  endedAt?: string | null;
}

export interface LinkedEquipmentItem {
  id: string;
  name: string;
}

export interface CartStatus {
  lastCheckedAt: string;
  allPassed: boolean;
  performedByName: string;
}

export interface SessionPollResult {
  session: CodeBlueSession | null;
  logEntries: CodeBlueLogEntry[];
  presence: Array<{ userId: string; userName: string; lastSeenAt: string }>;
  cartStatus: CartStatus | null;
  linkedEquipment: LinkedEquipmentItem[];
}

const SESSION_CACHE_KEY = "vt_cb_cache";
const ACTIVE_SESSION_QUERY_KEY = ["/api/code-blue/sessions/active"] as const;

/**
 * Grace window (R-CB-02 · CLICK-PATH-010) protecting a just-started Code Blue
 * session from a stale/racing `activeCodeBlueSessionId: null` keepalive. A null
 * keepalive younger than this is ignored (retain, no clearing refetch); only
 * after it may a confirming refetch clear — server-confirmed end only.
 */
export const RECONCILE_GRACE_MS = 5_000;

/** Clears tab-local CB poll cache (session end / server reports no active session). */
export function clearCodeBlueSessionCache(): void {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // ignore quota
  }
}

function clearCachedSession(): void {
  clearCodeBlueSessionCache();
}

function cacheSession(data: SessionPollResult) {
  if (!data.session || data.session.status !== "active") {
    clearCachedSession();
    return;
  }
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota
  }
}

function loadCachedSession(): SessionPollResult | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useCodeBlueSession() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const presenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const query = useQuery<SessionPollResult>({
    queryKey: ACTIVE_SESSION_QUERY_KEY,
    queryFn: async () => {
      const data = await api.codeBlue.sessions.getActive();
      const normalized: SessionPollResult = {
        ...data,
        linkedEquipment: data.linkedEquipment ?? [],
      };
      cacheSession(normalized);
      return normalized;
    },
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: () => loadCachedSession() ?? undefined,
    enabled: !!userId,
  });

  const sessionId = query.data?.session?.id ?? null;

  useEffect(() => {
    return subscribeKeepalive((payload) => {
      if (payload.activeCodeBlueSessionId !== null) return;
      // R-CB-02: a null keepalive must NOT optimistically clear a live session
      // (frozen doctrine — server-confirmed end only). Read the CURRENT session
      // from the cache (never a stale closure). Within the grace window of the
      // session start, retain and issue NO clearing refetch — the keepalive is
      // likely racing a just-started session. Only after grace may a confirming
      // refetch run; it clears solely on a confirmed null and retains if the
      // session is in fact still active.
      const current = queryClient.getQueryData<SessionPollResult>(ACTIVE_SESSION_QUERY_KEY);
      if (!current?.session) return;
      const startedAtMs = current.session.startedAt
        ? new Date(current.session.startedAt).getTime()
        : 0;
      if (Date.now() - startedAtMs < RECONCILE_GRACE_MS) return; // within grace → retain
      void queryClient.refetchQueries({ queryKey: ACTIVE_SESSION_QUERY_KEY }); // confirming refetch decides
    });
  }, [queryClient]);

  const sendPresence = useCallback(async () => {
    if (!sessionId) return;
    try {
      await api.codeBlue.sessions.sendPresence(sessionId);
    } catch {
      // non-critical
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    sendPresence();
    presenceTimerRef.current = setInterval(sendPresence, 10_000);
    return () => {
      if (presenceTimerRef.current) clearInterval(presenceTimerRef.current);
    };
  }, [sessionId, sendPresence]);

  const logEntry = useCallback(
    async (entry: {
      label: string;
      category: "equipment" | "note";
      equipmentId?: string;
    }) => {
      if (!sessionId) return;
      const elapsedMs = query.data?.session?.startedAt
        ? Date.now() - new Date(query.data.session.startedAt).getTime()
        : 0;

      const payload = {
        idempotencyKey: crypto.randomUUID(),
        elapsedMs,
        ...entry,
      };
      const optimisticId = `optimistic-${payload.idempotencyKey}`;

      // R-CB-03: cancel any in-flight refetch so it can't clobber the optimistic
      // write, then append the optimistic entry.
      await queryClient.cancelQueries({ queryKey: ACTIVE_SESSION_QUERY_KEY });

      queryClient.setQueryData<SessionPollResult>(ACTIVE_SESSION_QUERY_KEY, (prev) => {
        if (!prev?.session) return prev;
        return {
          ...prev,
          logEntries: [
            ...(prev.logEntries ?? []),
            {
              id: optimisticId,
              sessionId,
              elapsedMs,
              label: entry.label,
              category: entry.category,
              equipmentId: entry.equipmentId ?? null,
              loggedByUserId: userId ?? "",
              loggedByName: "",
              createdAt: new Date().toISOString(),
            },
          ],
        };
      });

      try {
        await api.codeBlue.sessions.appendLog(sessionId, payload);
      } catch (err) {
        // R-CB-03: remove ONLY the optimistic entry by its client id — never
        // restore a pre-request snapshot, which would erase teammates' entries
        // (and presence) that arrived via the 2s poll during this request.
        queryClient.setQueryData<SessionPollResult>(ACTIVE_SESSION_QUERY_KEY, (prev) => {
          if (!prev) return prev;
          return { ...prev, logEntries: (prev.logEntries ?? []).filter((e) => e.id !== optimisticId) };
        });
        if (!(err instanceof OfflineEmergencyMutationBlockedError)) {
          toast.error(t.api.networkUnavailable, { id: "cb-log-failed" });
        }
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ACTIVE_SESSION_QUERY_KEY });
    },
    [sessionId, query.data?.session?.startedAt, userId, queryClient],
  );

  return {
    session: query.data?.session ?? null,
    logEntries: query.data?.logEntries ?? [],
    presence: query.data?.presence ?? [],
    cartStatus: query.data?.cartStatus ?? null,
    linkedEquipment: query.data?.linkedEquipment ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    logEntry,
    refetch: query.refetch,
  };
}
