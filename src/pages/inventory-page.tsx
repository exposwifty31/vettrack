import { t } from "@/lib/i18n";
import { formatDepartmentLabel } from "@/lib/inventory-departments";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import { api } from "@/lib/api";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorCard } from "@/components/ui/error-card";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Package, Loader2, Minus, Plus, CheckCircle2, AlertTriangle, Nfc } from "lucide-react";
import { toast } from "sonner";
import { DispenseSheet } from "@/features/containers/components/DispenseSheet";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { InventoryContainer, RestockContainerLine } from "@/types";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  initialRestockSessionState,
  restockSessionReducer,
} from "@/features/inventory/restock-session-reducer";
import { useLocation } from "wouter";
import { getCurrentUserId } from "@/lib/auth-store";
import { useAuth } from "@/hooks/use-auth";
import { useExperience } from "@/hooks/use-experience";
import { isCustodyOnly } from "@/lib/roles/experience-model";
import { useNfcSupported } from "@/hooks/use-nfc-supported";
import { haptics } from "@/lib/haptics";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-browser";

/** Main page column is under `data-restock-allow` so it stays tappable if `Layout navigationLocked` is enabled. */

// ── Type for the container-items query response ────────────────────────────
// Mirrors what api.restock.containerItems() returns. If you have this type
// exported from @/types already, import it from there instead.
type ContainerItemsResponse = Awaited<ReturnType<typeof api.restock.containerItems>>;

// How a caller expresses the quantity change it wants scanLine to persist.
// `relative` is a nudge off whatever the row currently shows (+1, -1, fill to
// expected); `absolute` is a counted quantity the user stated outright. The
// distinction is load-bearing: a relative change has to be resolved against the
// live optimistic value at call time, while an absolute one must survive
// untouched — resolving it against anything is how a typed 7 became a persisted 8.
type RestockQuantityChange =
  | { kind: "relative"; delta: number }
  | { kind: "absolute"; observedQuantity: number };

/**
 * True while no LATER write for `key` has been ISSUED.
 *
 * The counterpart to `claimLatestWrite`, which answers "has a newer write
 * LANDED". Both questions are needed and they are not interchangeable: the
 * cache holds server-confirmed values, so ordering it by what landed is right,
 * but anything that feeds the NEXT request — a rollback, the NFC counter, the
 * row's optimistic quantity — must defer to what was issued. A write in flight
 * has already decided its number off the newer baseline; letting an earlier
 * response overwrite that is how a third scan recomputes from a stale count.
 */
function noNewerIssued(issued: Map<string, number>, key: string, ticket: number): boolean {
  return (issued.get(key) ?? 0) <= ticket;
}

function containerDotClass(container: InventoryContainer): string {
  if (container.targetQuantity === 0) return "bg-muted-foreground";
  const ratio = container.currentQuantity / container.targetQuantity;
  if (ratio >= 0.8) return "bg-[hsl(var(--status-ok))]";
  if (ratio >= 0.5) return "bg-[hsl(var(--status-stale))]";
  return "bg-[hsl(var(--status-issue))]";
}

export default function InventoryPage() {
  const qc = useQueryClient();
  const p = t.inventoryPage;
  const [location] = useLocation();
  const { userId } = useAuth();
  const experience = useExperience();
  const [sessionState, dispatch] = useReducer(restockSessionReducer, initialRestockSessionState);

  const [dispenseOpen, setDispenseOpen] = useState(false);
  const [dispenseContainerId, setDispenseContainerId] = useState<string | null>(null);

  // ── data ──────────────────────────────────────────────────────────────────

  const containersQ = useQuery({
    queryKey: ["/api/containers"],
    queryFn: () => api.containers.list(),
    enabled: !!userId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Defense-in-depth graceful-degrade: if a custody-only archetype ever gets a
  // 403 on the container list, render an expected, non-fatal "restricted" state
  // (via the shared capability model, not a role literal) so the page doesn't
  // blank into a scary "load failed" for a permissions boundary a retry can't
  // fix. NOTE (T26): the container/dispense/restock routes were reclassified
  // non-clinical (`requireEffectiveRole("student")`), so a student now gets 200
  // here — this branch no longer triggers for students under the current auth
  // config, but stays as a safety net for any residual custody-only 403. Any
  // other role hitting a real 403/500 still gets the normal fatal ErrorCard.
  const containersForbidden =
    containersQ.error instanceof ApiError && containersQ.error.status === 403;
  const containersRestrictedForRole = containersForbidden && isCustodyOnly(experience);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Preserve user-driven drawer selection across data refreshes.
  // Query param should initialize selection, not continuously override it.
  const containerFromQuery = useMemo(() => {
    const search = location.includes("?") ? location.slice(location.indexOf("?")) : "";
    const value = new URLSearchParams(search).get("container");
    return value && value.trim().length > 0 ? value.trim() : null;
  }, [location]);

  useEffect(() => {
    if (!containersQ.data?.length) return;
    setSelectedId((prev) => {
      if (containerFromQuery && containersQ.data.some((c) => c.id === containerFromQuery)) {
        if (prev == null) return containerFromQuery;
      }
      if (prev && containersQ.data.some((c) => c.id === prev)) return prev;
      return containersQ.data[0].id;
    });
  }, [containersQ.data, containerFromQuery]);

  const selected = containersQ.data?.find((c) => c.id === selectedId) ?? null;

  const detailsQ = useQuery({
    queryKey: ["/api/restock/container-items", selectedId],
    queryFn: () => api.restock.containerItems(selectedId!),
    enabled: !!userId && Boolean(selectedId),
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Sync active session owned by this user from server
  useEffect(() => {
    const active = detailsQ.data?.activeSession;
    if (!active || !selectedId || active.ownedByUserId !== getCurrentUserId()) return;
    dispatch({ type: "start-success", payload: { sessionId: active.id, containerId: selectedId } });
  }, [detailsQ.data?.activeSession, selectedId]);

  // Persist active session across page reloads
  useEffect(() => {
    if (sessionState.activeSessionId && sessionState.activeContainerId) {
      safeStorageSetItem(
        "vt_active_restock_session",
        JSON.stringify({
          sessionId: sessionState.activeSessionId,
          containerId: sessionState.activeContainerId,
        })
      );
    } else {
      safeStorageRemoveItem("vt_active_restock_session");
    }
  }, [sessionState.activeSessionId, sessionState.activeContainerId]);

  // ── derived state ─────────────────────────────────────────────────────────

  const lines = detailsQ.data?.lines ?? [];
  const activeSessionOwnedByMe = Boolean(
    sessionState.activeSessionId && selectedId && sessionState.activeContainerId === selectedId,
  );
  const otherUserHasSession =
    !!detailsQ.data?.activeSession &&
    detailsQ.data.activeSession.ownedByUserId !== getCurrentUserId();
  const missingCount = useMemo(() => lines.filter((l) => l.missing > 0).length, [lines]);
  const totalItems = lines.length;
  const completedCount = useMemo(() => lines.filter((l) => l.actual >= l.expected).length, [lines]);
  const progressPct = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;
  const progressColor =
    progressPct < 40
      ? "bg-[hsl(var(--status-issue))]"
      : progressPct < 80
        ? "bg-[hsl(var(--status-stale))]"
        : "bg-[hsl(var(--status-ok))]";
  const isRestocking = activeSessionOwnedByMe;

  // ── refs ──────────────────────────────────────────────────────────────────

  const sessionIdRef = useRef<string | null>(null);
  const activeContainerIdRef = useRef<string | null>(null);
  const startSessionPromiseRef = useRef<Promise<string | null> | null>(null);
  const overlayClearRef = useRef<number | undefined>(undefined);
  const nfcActiveRef = useRef(false);
  // Monotonically-increasing observed count per NFC tag for the current session.
  // Using a ref so updates don't trigger re-renders. Cleared when session changes.
  const nfcItemCountsRef = useRef<Map<string, number>>(new Map<string, number>());
  // Stable ref to the latest handleNFCTag — avoids stale closure in ndef.onreading.
  const handleNFCTagRef = useRef<(tagId: string) => void>(() => {});

  useEffect(() => { sessionIdRef.current = sessionState.activeSessionId ?? null; }, [sessionState.activeSessionId]);
  useEffect(() => { activeContainerIdRef.current = sessionState.activeContainerId ?? null; }, [sessionState.activeContainerId]);
  // Clear per-tag NFC counts whenever the session changes (start or finish).
  // Persists counts to sessionStorage so they survive page reloads within the
  // same browser tab. On session start, restores persisted counts first, then
  // merges any layout.tsx seed (layout→inventory NFC transition).
  useEffect(() => {
    nfcItemCountsRef.current.clear();
    if (!sessionState.activeSessionId) {
      safeStorageRemoveItem("vt_nfc_counts", "session");
      return;
    }
    // Restore counts that survived a page reload for this session
    const storedRaw = safeStorageGetItem("vt_nfc_counts", "session");
    if (storedRaw) {
      try {
        const stored = JSON.parse(storedRaw) as { sessionId: string; counts: Record<string, number> };
        if (stored.sessionId === sessionState.activeSessionId) {
          for (const [k, v] of Object.entries(stored.counts)) {
            nfcItemCountsRef.current.set(k, v);
          }
        }
      } catch { /* ignore */ }
    }
    // Also merge any layout.tsx seed (one-off NFC scan before navigating here)
    const seedRaw = safeStorageGetItem("vt_nfc_scan_seed");
    if (seedRaw) {
      try {
        const seed = JSON.parse(seedRaw) as { tagId: string; count: number };
        if (seed.tagId && seed.count > 0) {
          nfcItemCountsRef.current.set(seed.tagId, Math.max(
            nfcItemCountsRef.current.get(seed.tagId) ?? 0,
            seed.count
          ));
        }
      } catch { /* ignore malformed seed */ }
      safeStorageRemoveItem("vt_nfc_scan_seed");
    }
  }, [sessionState.activeSessionId]);

  // ── UI state ──────────────────────────────────────────────────────────────

  const [flashRowId, setFlashRowId] = useState<{ id: string; type: "success" | "error" } | null>(null);
  const [scanOverlay, setScanOverlay] = useState<{ label: string; delta: number | null } | null>(null);
  const [scanGeneration, setScanGeneration] = useState(0);
  const [isNfcStarting, setIsNfcStarting] = useState(false);
  // Live NFC state drives the button (a ref alone never re-renders, so the button
  // couldn't reflect a stalled session or offer a way to recover — it just sat
  // "NFC Live" and disabled). Mirrors the equipment NfcForegroundScan toggle.
  const [nfcActive, setNfcActive] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Per-row optimistic state — keyed by item code
  const [optimisticActualByCode, setOptimisticActualByCode] = useState<Record<string, number>>({});
  const [rowPendingByCode, setRowPendingByCode] = useState<Record<string, number>>({});
  const [rowPulseCode, setRowPulseCode] = useState<string | null>(null);

  // ── overlay ───────────────────────────────────────────────────────────────

  const showScanOverlay = useCallback((label: string, delta: number | null) => {
    if (overlayClearRef.current !== undefined) clearTimeout(overlayClearRef.current);
    setScanOverlay({ label, delta });
    overlayClearRef.current = window.setTimeout(() => {
      setScanOverlay(null);
      overlayClearRef.current = undefined;
    }, 1200);
  }, []);

  useEffect(() => () => {
    if (overlayClearRef.current !== undefined) clearTimeout(overlayClearRef.current);
  }, []);

 // Reset optimistic state when container switches OR when data first loads.
  // Using detailsQ.isSuccess (boolean) instead of detailsQ.data — isSuccess flips
  // false→true exactly once per container load then stays true, so this effect
  // does NOT re-run on every setQueryData call from our own scans.
  useEffect(() => {
    if (!detailsQ.data?.lines) return;
    const next: Record<string, number> = {};
    for (const line of detailsQ.data.lines) {
      next[line.code] = line.actual;
    }
    setOptimisticActualByCode(next);
    setRowPendingByCode({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, detailsQ.isSuccess]);
  
  // ── mutations ─────────────────────────────────────────────────────────────

  const startSessionMut = useMutation({
    mutationFn: (containerId: string) => api.restock.start(containerId),
    onSuccess: (session) => {
      dispatch({ type: "start-success", payload: { sessionId: session.id, containerId: session.containerId } });
      qc.invalidateQueries({ queryKey: ["/api/restock/container-items", session.containerId] });
      haptics.scanSuccess();
    },
    onError: (err) => {
      const fallback = p.startSessionFailed;
      const requestId = err instanceof ApiError ? err.requestId : undefined;
      const display = requestId ? p.errorWithRequestId(fallback, requestId) : fallback;
      dispatch({ type: "failure", payload: { message: display } });
      toast.error(display);
    },
  });

  const scanMut = useMutation({
    mutationFn: (payload: { sessionId: string; itemId?: string; nfcTagId?: string; observedQuantity: number }) =>
      api.restock.scan(payload.sessionId, {
        itemId: payload.itemId,
        nfcTagId: payload.nfcTagId,
        observedQuantity: payload.observedQuantity,
      }),
    onSuccess: () => {
      dispatch({ type: "scan-success" });
    },
    onError: (err) => {
      // Phase 5 PR 5.4 — log the full error to the browser console for
      // diagnostic visibility (the user-facing toast only carries the
      // `message` + `requestId`; operators need the response payload
      // including the new `errorType` field surfaced by the server).
      console.error("[restock] scan failed", err);
      const message = err instanceof Error ? err.message : "Failed to apply scan";
      dispatch({ type: "failure", payload: { message } });
    },
  });

  const finishMut = useMutation({
    mutationFn: (sessionId: string) => api.restock.finish(sessionId),
    onSuccess: (summary) => {
      dispatch({
        type: "finish-success",
        payload: {
          totalAdded: summary.totalAdded,
          totalRemoved: summary.totalRemoved,
          itemsMissingCount: summary.itemsMissingCount,
        },
      });
      // Full refetch after finish is correct — session is over, we want fresh server state
      if (selectedId) qc.invalidateQueries({ queryKey: ["/api/restock/container-items", selectedId] });
      haptics.error();
    },
    onError: (err) => {
      // Phase 5 PR 5.4 — diagnostic logging; see scanMut.onError above.
      console.error("[restock] finish failed", err);
      // NO_ITEMS_COUNTED is not a fault — the server refused to close a session
      // that counted nothing. "Please try again" is wrong guidance there (a
      // retry can never succeed), so it gets its own actionable message and no
      // request-id suffix, which would frame user guidance as something to report.
      if (err instanceof ApiError && err.code === "NO_ITEMS_COUNTED") {
        const message = p.finishSessionNoItems;
        dispatch({ type: "failure", payload: { message } });
        toast.error(message);
        return;
      }
      const fallback = p.finishSessionFailed;
      const requestId = err instanceof ApiError ? err.requestId : undefined;
      const display = requestId ? p.errorWithRequestId(fallback, requestId) : fallback;
      dispatch({ type: "failure", payload: { message: display } });
      toast.error(display);
    },
  });

  const bootstrapMut = useMutation({
    mutationFn: () => api.containers.bootstrapDefaults(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["/api/containers"] });
      if (res.inserted > 0) { haptics.itemAdded(); toast.success(p.quickAddSuccess); }
      else toast(p.quickAddNothing);
    },
    onError: () => toast.error(p.loadError),
  });

  // ── session helpers ───────────────────────────────────────────────────────

  const getOrCreateSession = useCallback(async (): Promise<string | null> => {
    if (!selectedId) return null;
    const existingId = sessionIdRef.current;
    if (existingId && activeContainerIdRef.current === selectedId) return existingId;
    // Coalesce: if a start-session request is already in-flight, reuse it
    // to prevent duplicate DB inserts when multiple taps fire before the first
    // request completes (causes unique constraint violations in vt_restock_sessions).
    if (startSessionPromiseRef.current) return startSessionPromiseRef.current;
    dispatch({ type: "start-request" });
    const promise = startSessionMut.mutateAsync(selectedId).then((session) => {
      sessionIdRef.current = session.id;
      activeContainerIdRef.current = selectedId;
      return session.id as string | null;
    }).catch(() => null as string | null).finally(() => {
      startSessionPromiseRef.current = null;
    });
    startSessionPromiseRef.current = promise;
    return promise;
  }, [selectedId, startSessionMut]);

  // ── write ordering ────────────────────────────────────────────────────────
  // Every restock write decides its quantity BEFORE it awaits, so the order the
  // network answers in is not the order the user acted in: a call issued first
  // can come back last and patch its superseded count over a newer one. The
  // damage is invisible — rows render `optimisticActualByCode`, which still
  // holds the newest number — and surfaces one interaction later in
  // `commitInlineEdit`, where a stale cached `sessionObservedQuantity` makes a
  // genuine re-count to that number look like an already-recorded no-op and
  // silently drops it.
  //
  // So each write takes a monotonic ticket before its first await and may only
  // apply its result if no higher-numbered ticket for the SAME item has applied
  // already. Per item, because two rows scanned at once are not a race.
  // Refs rather than state: `scanLine`'s dep array deliberately excludes cache
  // data to stay memoized (see the FIX note on its deps), and a state dep here
  // would undo exactly that.
  const writeTicketRef = useRef(0);
  // Keyed by row CODE, not item id. `code` is what the optimistic state itself
  // is keyed by (`optimisticActualByCode`), and it is the only key available on
  // EVERY path — the session-failure rollback runs before `resolvedItemId`
  // exists, so an id-keyed ticket could not guard it at all.
  const appliedTicketByCodeRef = useRef<Map<string, number>>(new Map<string, number>());
  // The applied map answers "has a newer write LANDED". A rollback needs the
  // other question — "has a newer write been ISSUED" — and the two differ for
  // exactly the window that matters: an earlier write failing while a later one
  // is still in flight sees an empty applied map, out-ranks nothing, and writes
  // its stale pre-await value over a row the pending write already owns.
  const issuedTicketByCodeRef = useRef<Map<string, number>>(new Map<string, number>());
  // The NFC fallback path needs the same ownership answer keyed by TAG: it is
  // the only key it holds when it issues, because the item code arrives with
  // the response — that is what makes it the fallback path.
  const issuedTicketByTagRef = useRef<Map<string, number>>(new Map<string, number>());

  /**
   * Claims the right to apply this write's result for `itemId`, returning false
   * when a later-issued write for that item already landed — the caller then
   * drops its patch instead of resurrecting a superseded quantity.
   *
   * The ticket counter never resets, so an entry left behind by a previous
   * container is always lower than a live ticket and can never block one; the
   * map holds one number per item ever scanned in this page's lifetime.
   */
  const claimLatestWrite = useCallback((code: string, ticket: number): boolean => {
    const applied = appliedTicketByCodeRef.current.get(code) ?? 0;
    if (applied > ticket) return false;
    appliedTicketByCodeRef.current.set(code, ticket);
    return true;
  }, []);

  /**
   * Undo this write's optimistic patch by DROPPING the row's override rather
   * than restoring the value captured before the awaits. The row then falls
   * back to `line.actual` (see the row render), which is the cache — and the
   * cache holds exactly what succeeded. Restoring a captured number instead is
   * wrong whenever any other write for the row also failed: two failures would
   * each restore their own pre-await value and the survivor would be a quantity
   * the server never held.
   */
  const dropOptimisticRow = useCallback((code: string) => {
    setOptimisticActualByCode((prev) => {
      if (!(code in prev)) return prev;
      const next = { ...prev };
      delete next[code];
      return next;
    });
  }, []);

  // ── scan line ─────────────────────────────────────────────────────────────

  const scanLine = useCallback(
    async (itemId: string | null, code: string, label: string, change: RestockQuantityChange) => {
      if (!selectedId) return;

      // Taken before any await, so ordering follows when the write was ISSUED.
      const writeTicket = ++writeTicketRef.current;
      issuedTicketByCodeRef.current.set(code, writeTicket);

      // ── 1. Instant optimistic update (synchronous, <1ms) ──────────────────
      const currentValue = optimisticActualByCode[code] ?? lines.find((l) => l.code === code)?.actual ?? 0;
      const nextValue =
        change.kind === "absolute"
          ? Math.max(0, change.observedQuantity)
          : Math.max(0, currentValue + change.delta);
      // What the row actually moves by — the overlay reports the movement the
      // user sees, which for an absolute count is not the number they typed.
      const delta = nextValue - currentValue;

      setOptimisticActualByCode((prev) => ({ ...prev, [code]: nextValue }));
      setRowPendingByCode((prev) => ({ ...prev, [code]: (prev[code] ?? 0) + 1 }));
      setRowPulseCode(code);
      setTimeout(() => setRowPulseCode(null), 220);

      // ── 2. Ensure session exists (may be instant if already open) ─────────
      const sessionId = await getOrCreateSession();

      if (!sessionId) {
        // Session failed — undo this write's optimistic patch, but only while
        // it is still the newest write ISSUED for the row. A later write, landed
        // or merely in flight, owns the display and will settle it itself.
        if (noNewerIssued(issuedTicketByCodeRef.current, code, writeTicket)) dropOptimisticRow(code);
        setRowPendingByCode((prev) => ({ ...prev, [code]: Math.max(0, (prev[code] ?? 1) - 1) }));
        return;
      }

      let resolvedItemId = itemId;

      try {
        // ── 3. Resolve itemId if not passed directly ───────────────────────
        // Check cache first — avoids a network round-trip on every tap.
        if (!resolvedItemId) {
          const cached = qc.getQueryData<ContainerItemsResponse>(
            ["/api/restock/container-items", selectedId]
          );
          resolvedItemId = cached?.lines.find((l) => l.code === code)?.itemId ?? null;

          // Only hit network if truly not in cache
          if (!resolvedItemId) {
            const latest = await api.restock.containerItems(selectedId);
            qc.setQueryData<ContainerItemsResponse>(
              ["/api/restock/container-items", selectedId],
              latest
            );
            resolvedItemId = latest.lines.find((l) => l.code === code)?.itemId ?? null;
          }
        }

        if (!resolvedItemId) throw new Error("Missing item id");

        // Capture narrowed non-null type for use inside callbacks/closures
        const confirmedItemId: string = resolvedItemId;

        dispatch({ type: "scan-request" });

        const result = await scanMut.mutateAsync({
          sessionId,
          itemId: confirmedItemId,
          observedQuantity: nextValue,
        });

        const name = result?.item?.label ?? label;

        setFlashRowId({ id: confirmedItemId, type: "success" });
        setTimeout(() => setFlashRowId(null), 600);

        haptics.tap();
        showScanOverlay(name, delta);
        setScanGeneration((g) => g + 1);

        // The scan itself succeeded, so the acknowledgement above is truthful
        // either way. What must not regress is the persisted-quantity mirror:
        // `nextValue` was decided before this call's two awaits, so it may only
        // be written while no later-issued scan for this item has landed.
        if (!claimLatestWrite(code, writeTicket)) return;

        // ── 4. Patch cache in-place — no network refetch ───────────────────
        // FIX: replaced invalidateQueries() here with setQueryData().
        // invalidateQueries was causing a full refetch on every tap, which
        // wiped the optimistic state and made the UI feel laggy.
        qc.setQueryData<ContainerItemsResponse>(
          ["/api/restock/container-items", selectedId],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              lines: old.lines.map((l) =>
                l.itemId === confirmedItemId
                  ? { ...l, actual: nextValue, sessionObservedQuantity: nextValue }
                  : l
              ),
            };
          }
        );
      } catch {
        // Same rule as the session-failure path: a failing EARLIER scan must not
        // overwrite a newer count, and "newer" means issued, not landed.
        if (noNewerIssued(issuedTicketByCodeRef.current, code, writeTicket)) dropOptimisticRow(code);

        if (resolvedItemId) {
          setFlashRowId({ id: resolvedItemId, type: "error" });
          setTimeout(() => setFlashRowId(null), 600);
        }

        haptics.error();
        showScanOverlay(label, null);
      } finally {
        // Always clear the pending spinner for this row
        setRowPendingByCode((prev) => ({
          ...prev,
          [code]: Math.max(0, (prev[code] ?? 1) - 1),
        }));
      }
    },
    [
      claimLatestWrite,
      getOrCreateSession,
      lines,
      optimisticActualByCode,
      qc,
      scanMut,
      selectedId,
      showScanOverlay,
      // FIX: removed detailsQ.data from deps — it was causing scanLine to be
      // recreated on every cache update, defeating useCallback memoization.
      // Cache is now read via qc.getQueryData() at call time instead.
    ],
  );

  // ── inline edit ───────────────────────────────────────────────────────────

  const startInlineEdit = useCallback((line: RestockContainerLine) => {
    if (!line.itemId || otherUserHasSession) return;
    setEditingCode(line.code);
    // Seed from the value the ROW IS SHOWING, not the raw cache value. While a
    // tap's scan is in flight the two differ, and seeding from the cache put the
    // editor in a different reference frame than the number the user is reading.
    setEditValue(String(optimisticActualByCode[line.code] ?? line.actual));
    setTimeout(() => editInputRef.current?.select(), 30);
  }, [optimisticActualByCode, otherUserHasSession]);

  const commitInlineEdit = useCallback(async (line: RestockContainerLine) => {
    setEditingCode(null);
    const parsed = parseInt(editValue, 10);
    if (isNaN(parsed) || parsed < 0) return;
    // A count that merely equals the HELD stock is still a count: recording it
    // is what separates "counted, and it matched" from "never counted". The one
    // genuine no-op is a count the server has ALREADY recorded this session, so
    // re-committing the same number doesn't re-post it.
    if (line.sessionObservedQuantity != null && parsed === line.sessionObservedQuantity) return;
    // An inline edit is a stated count, not a nudge: post it as-is. Deriving a
    // delta here and applying it against the optimistic base later is what made
    // the persisted quantity drift from the typed one.
    await scanLine(line.itemId, line.code, line.label, { kind: "absolute", observedQuantity: parsed });
  }, [editValue, scanLine]);

  // ── tab selection ─────────────────────────────────────────────────────────

  const trySelectContainer = (id: string) => {
    if (isRestocking && id !== selectedId) {
      haptics.error();
      toast.warning(p.finishRestockWarning);
      return;
    }
    setEditingCode(null);
    setScanOverlay(null);
    startSessionPromiseRef.current = null;
    setSelectedId(id);
  };

  const finishSession = () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    dispatch({ type: "finish-request" });
    finishMut.mutate(sid);
  };

  // ── NFC ───────────────────────────────────────────────────────────────────

  const { supported: nfcSupported } = useNfcSupported();

  const handleNFCTag = useCallback((tagId: string) => {
    // Container tag → switch tab + start session
    const container = containersQ.data?.find((c) => c.nfcTagId === tagId);
    if (container) {
      if (isRestocking && container.id !== selectedId) {
        haptics.error();
        toast.warning(p.finishRestockWarning);
        return;
      }
      setSelectedId(container.id);
      haptics.scanSuccess();
      if (!(sessionIdRef.current && activeContainerIdRef.current === container.id)) {
        dispatch({ type: "start-request" });
        startSessionMut.mutateAsync(container.id).catch(() => {});
      }
      return;
    }
    // Item tag → route through scanLine when cached line is available (avoids baseline mismatch)
    const sessionId = sessionIdRef.current;
    if (!sessionId) { toast.error(p.openSessionFirst); return; }
    const cachedLine = detailsQ.data?.lines.find((l) => l.nfcTagId === tagId);
    if (cachedLine?.itemId && cachedLine.code) {
      scanLine(cachedLine.itemId, cachedLine.code, cachedLine.label, { kind: "relative", delta: 1 });
      return;
    }
    // Fallback: item tag found in NFC table but not yet resolved in cache — direct scan path.
    // Abort if cache is cold to avoid sending observedQuantity from a zero baseline.
    if (!detailsQ.data) { toast.error(p.openSessionFirst); return; }
    const prevCount = nfcItemCountsRef.current.get(tagId) ?? (cachedLine?.sessionObservedQuantity ?? cachedLine?.actual ?? 0);
    const newCount = prevCount + 1;
    nfcItemCountsRef.current.set(tagId, newCount);
    dispatch({ type: "scan-request" });
    // Same ordering rule as scanLine — this path awaits its scan too, so its
    // count can be superseded by a row tap or inline edit that lands first.
    const writeTicket = ++writeTicketRef.current;
    issuedTicketByTagRef.current.set(tagId, writeTicket);
    scanMut
      .mutateAsync({ sessionId, nfcTagId: tagId, observedQuantity: newCount })
      .then((result) => {
        // Three writes, three different questions — this is the whole ordering
        // rule in one place. The CACHE holds server-confirmed values, so it is
        // ordered by what LANDED (`claimLatestWrite`). The NFC counter and the
        // row's optimistic quantity both feed the NEXT request, so they defer
        // to what was ISSUED, in their own keyspaces: tag for the counter, code
        // for the row. Collapsing all three onto `claimLatestWrite` is what let
        // an earlier response reset a baseline a pending scan already owned.
        if (claimLatestWrite(result.item.code, writeTicket)) {
          // The counter is the baseline for the NEXT scan of this TAG, so it
          // defers to what was issued, not to what landed. `claimLatestWrite`
          // alone accepts an earlier response while a newer scan is still in
          // flight: 5 answers, the counter drops back to 5, and a third scan
          // started in that window posts 6 instead of 7.
          if (noNewerIssued(issuedTicketByTagRef.current, tagId, writeTicket)) {
            nfcItemCountsRef.current.set(tagId, result.observedQuantity);
            // Persist counts so they survive a page reload within the same session.
            // sessionStorage is tab-scoped and is automatically cleared on tab close.
            if (sessionIdRef.current) {
              const countsObj: Record<string, number> = {};
              nfcItemCountsRef.current.forEach((v, k) => { countsObj[k] = v; });
              safeStorageSetItem(
                "vt_nfc_counts",
                JSON.stringify({ sessionId: sessionIdRef.current, counts: countsObj }),
                "session"
              );
            }
          }
          // Same rule in the other keyspace: the ROW is keyed by code, and an
          // inline edit already issued against it owns what the row shows.
          if (noNewerIssued(issuedTicketByCodeRef.current, result.item.code, writeTicket)) {
            setOptimisticActualByCode((prev) => ({ ...prev, [result.item.code]: result.observedQuantity }));
          }
          qc.setQueryData<ContainerItemsResponse>(
            ["/api/restock/container-items", selectedId ?? ""],
            (old) => {
              if (!old) return old;
              return {
                ...old,
                lines: old.lines.map((l) =>
                  l.itemId === result.item.id
                    ? { ...l, actual: result.observedQuantity, sessionObservedQuantity: result.observedQuantity }
                    : l
                ),
              };
            }
          );
        }
        showScanOverlay(result.item.label, 1);
        haptics.tap();
        setScanGeneration((g) => g + 1);
      })
      .catch(() => {
        // Same rule as scanLine's rollback, and for the same reason: undo only
        // while this write still owns the tag's baseline. Restoring `prevCount`
        // unconditionally is what let a FAILING earlier scan walk the counter
        // backwards past a newer one that had already succeeded — post 5, post
        // 6, the 6 lands, the 5 rejects, counter back to 4, next scan posts 5
        // over a server holding 6.
        //
        // And it DROPS the entry rather than restoring a number, so the next
        // read falls back to the cached line (see `prevCount` above) — which is
        // what actually succeeded. Restoring is wrong whenever a second scan
        // for the tag also failed: each would restore its own stale baseline.
        if (noNewerIssued(issuedTicketByTagRef.current, tagId, writeTicket)) {
          nfcItemCountsRef.current.delete(tagId);
        }
        showScanOverlay(p.unknownNfcTag, null);
        haptics.error();
      });
  }, [claimLatestWrite, containersQ.data, detailsQ.data, isRestocking, selectedId, startSessionMut, scanMut, showScanOverlay, scanLine]);

  // Keep ref pointing at the latest version — ndef.onreading uses the ref so it
  // is never bound to a stale closure when handleNFCTag deps change.
  useEffect(() => {
    handleNFCTagRef.current = handleNFCTag;
  }, [handleNFCTag]);

  const nfcSessionStopRef = useRef<(() => Promise<void>) | null>(null);

  const startNFCScan = async () => {
    if (!nfcSupported || nfcActiveRef.current) return;
    setIsNfcStarting(true);
    try {
      const { startNfcScanSession, resolveNfcTagId } = await import("@/lib/nfc-platform");
      const session = await startNfcScanSession({
        onRead: async (payload) => {
          const tagId = resolveNfcTagId(payload);
          if (tagId) handleNFCTagRef.current(tagId);
        },
      });
      nfcSessionStopRef.current = session.stop;
      nfcActiveRef.current = true;
      setNfcActive(true);
      haptics.scanSuccess();
      toast.success(p.nfcReady, { duration: 3200 });
    } catch {
      haptics.error();
      toast.error(p.nfcStartFailed);
    } finally {
      setIsNfcStarting(false);
    }
  };

  const stopNFCScan = useCallback(async () => {
    const stop = nfcSessionStopRef.current;
    nfcSessionStopRef.current = null;
    nfcActiveRef.current = false;
    setNfcActive(false);
    await stop?.().catch(() => {});
  }, []);

  // Tear the NFC session down on unmount so it can't leak / stay open across pages.
  useEffect(() => () => { void stopNFCScan(); }, [stopNFCScan]);

  const handleOpenDispense = useCallback(() => {
    if (!selectedId) {
      toast.error(p.noContainers);
      return;
    }
    setDispenseContainerId(selectedId);
    setDispenseOpen(true);
  }, [selectedId]);

  const handleCloseDispense = useCallback(() => {
    setDispenseOpen(false);
    setDispenseContainerId(null);
  }, []);

  // ── render ────────────────────────────────────────────────────────────────

  const pageContent = (
    <>
      <Helmet>
        <title>{p.title} — VetTrack</title>
      </Helmet>

      <div className="mx-auto w-full max-w-[720px] space-y-4 px-4 pb-24 pt-3 motion-safe:animate-page-enter sm:px-6 lg:max-w-[1120px]" data-restock-allow>

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold flex items-center gap-2 tracking-tight min-w-0">
            <Package className="w-7 h-7 text-primary shrink-0" aria-hidden />
            {p.title}
          </h1>
          {nfcSupported && (
            <Button
              variant={nfcActive ? "default" : "outline"}
              size="sm"
              onClick={() => (nfcActive ? void stopNFCScan() : void startNFCScan())}
              disabled={isNfcStarting}
              aria-pressed={nfcActive}
              className="gap-1.5 shrink-0 min-h-[40px]"
            >
              {isNfcStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Nfc className="w-4 h-4" />}
              {nfcActive ? p.nfcLive : isNfcStarting ? p.nfcStarting : p.nfcLabel}
            </Button>
          )}
        </div>

        {/* Loading skeleton */}
        {containersQ.isLoading && (
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-28 rounded-full" />
            <Skeleton className="h-9 w-36 rounded-full" />
          </div>
        )}

        {/* Fetch error — a genuine failure (network/server) still shows the fatal
            retry card; a role-gated 403 for a custody-only user does not. */}
        {containersQ.isError && !containersRestrictedForRole && (
          <ErrorCard message={p.loadError} onRetry={() => containersQ.refetch()} />
        )}

        {/* Restricted state — custody-only role, container list is above their
            authorization. No retry action: retrying can't change a permission
            boundary. */}
        {containersRestrictedForRole && (
          <EmptyState
            icon={Package}
            message={p.restrictedAccessTitle}
            subMessage={p.restrictedAccessMessage}
          />
        )}

        {/* Empty state */}
        {containersQ.data?.length === 0 && !containersQ.isLoading && (
          <EmptyState
            icon={Package}
            message={p.empty}
            action={
              <Button
                variant="default"
                size="lg"
                className="min-h-[48px] rounded-xl font-semibold"
                disabled={bootstrapMut.isPending}
                onClick={() => bootstrapMut.mutate()}
              >
                {bootstrapMut.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                {p.quickAdd}
              </Button>
            }
          />
        )}

        {/* Tab strip */}
        {containersQ.data && containersQ.data.length > 0 && (
          <div className="sticky top-2 z-20 rounded-2xl border border-border/70 bg-background/95 backdrop-blur px-2 py-2 shadow-sm">
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {containersQ.data.map((container: InventoryContainer) => (
                <button
                  key={container.id}
                  type="button"
                  onClick={() => trySelectContainer(container.id)}
                  className={cn(
                    "shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm font-medium transition-all whitespace-nowrap min-h-[44px]",
                    selectedId === container.id
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-card border-border text-foreground hover:bg-muted",
                  )}
                >
                  <span className={cn("w-2 h-2 rounded-full shrink-0", containerDotClass(container))} />
                  <span className="max-w-[96px] truncate" dir="auto">{container.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Take-consumables action — inline so it scrolls with the page (BUG-010) */}
        {containersQ.data && containersQ.data.length > 0 && (
          <Button
            type="button"
            size="lg"
            onClick={handleOpenDispense}
            className="w-full gap-2 text-base"
          >
            <span aria-hidden className="text-lg">📦</span>
            {p.takeConsumables}
          </Button>
        )}

        {/* Container detail card */}
        {selected && (
          <Card className="overflow-hidden border-border/80 shadow-sm">
            <CardContent className="p-0">

              {/* Card header */}
              <div
                className={cn(
                  "px-4 py-3 border-b text-sm font-semibold flex flex-wrap items-start justify-between gap-2",
                  isRestocking
                    ? "bg-[var(--status-stale-bg)] text-[var(--status-stale-fg)] border-[var(--status-stale-border)]"
                    : "bg-muted text-muted-foreground border-border",
                )}
              >
                <span className="min-w-0 flex-1 break-words">
                  {isRestocking ? p.restockingLabel(selected.name) : selected.name}
                </span>
                {selected.department && (
                  <span className="text-xs font-normal opacity-60 shrink-0">{formatDepartmentLabel(selected.department)}</span>
                )}
              </div>

              {/* Progress bar */}
              {detailsQ.data && totalItems > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 border-b bg-card">
                  <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0">
                    {completedCount}/{totalItems}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-300", progressColor)}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground w-8 text-end shrink-0">
                    {progressPct}%
                  </span>
                </div>
              )}

              {/* All stocked banner */}
              {detailsQ.data && missingCount === 0 && totalItems > 0 && (
                <div className="mx-4 mt-3 mb-1 rounded-lg border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] px-3 py-2 text-center text-sm font-medium text-[var(--status-ok-fg)]">
                  {p.allItemsStocked}
                </div>
              )}

              {/* Session error */}
              {sessionState.errorMessage && (
                <div className="mx-4 mt-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {sessionState.errorMessage}
                </div>
              )}

              {/* Other user restocking warning */}
              {otherUserHasSession && (
                <div className="mx-4 mt-3 rounded-xl border border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] p-3 text-sm text-[var(--status-stale-fg)]">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {p.otherUserRestocking}
                  </div>
                </div>
              )}

              {/* Items skeleton */}
              {detailsQ.isLoading && (
                <div className="space-y-2 p-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="rounded-xl border border-border/70 p-3 space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <div className="flex justify-between items-center">
                        <Skeleton className="h-10 w-10 rounded-xl" />
                        <Skeleton className="h-6 w-16 rounded-md" />
                        <Skeleton className="h-10 w-10 rounded-xl" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Items fetch error */}
              {detailsQ.isError && (
                <div className="p-4">
                  <ErrorCard message={p.loadError} onRetry={() => detailsQ.refetch()} />
                </div>
              )}

              {/* Item rows */}
              {detailsQ.data && (
                <div className="space-y-2 p-3">
                  {lines.map((line) => {
                    const optimisticActual = optimisticActualByCode[line.code] ?? line.actual;
                    const isComplete = optimisticActual >= line.expected;
                    const isEditing = editingCode === line.code;
                    const pendingOps = rowPendingByCode[line.code] ?? 0;
                    const missing = Math.max(0, line.expected - optimisticActual);
                    const isLowStock = optimisticActual < line.expected;
                    const flash =
                      line.itemId && flashRowId?.id === line.itemId
                        ? flashRowId.type === "success"
                          ? "bg-[var(--status-ok-bg)]"
                          : "bg-[var(--status-issue-bg)]"
                        : "";

                    return (
                      <div
                        key={line.code}
                        className={cn(
                          "rounded-xl border border-border/70 px-3 py-3 bg-card transition-all duration-200",
                          flash,
                          rowPulseCode === line.code && "ring-2 ring-[hsl(var(--status-ok))]",
                          pendingOps > 0 && "opacity-95",
                        )}
                      >
                        <div className="flex w-full items-center gap-3">

                          {/* Label + status badge */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  isComplete
                                    ? "bg-[hsl(var(--status-ok))]"
                                    : optimisticActual === 0
                                      ? "bg-[hsl(var(--status-issue))]"
                                      : "bg-[hsl(var(--status-stale))]",
                                )}
                              />
                              <p className="text-sm font-semibold min-w-0 truncate" dir="auto">{line.label}</p>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              {isLowStock ? (
                                <span className="inline-flex items-center rounded-full border border-[var(--status-stale-border)] bg-[var(--status-stale-bg)] px-2 py-0.5 text-[var(--status-stale-fg)]">
                                  {p.shortBy(missing)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-full border border-[var(--status-ok-border)] bg-[var(--status-ok-bg)] px-2 py-0.5 text-[var(--status-ok-fg)]">
                                  {p.stocked}
                                </span>
                              )}
                              {pendingOps > 0 && (
                                <span className="inline-flex items-center gap-1 text-muted-foreground">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  {p.syncing}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Quantity controls */}
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-11 w-11 rounded-xl shrink-0"
                              disabled={otherUserHasSession || pendingOps > 0}
                              onClick={() => scanLine(line.itemId, line.code, line.label, { kind: "relative", delta: -1 })}
                              aria-label={`Decrement ${line.label}`}
                            >
                              <Minus className="w-4 h-4" />
                            </Button>

                            {isEditing ? (
                              <input
                                ref={editInputRef}
                                type="number"
                                min={0}
                                className="w-16 h-11 text-center text-base font-semibold tabular-nums rounded-lg border border-primary bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => commitInlineEdit(line)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                  if (e.key === "Escape") setEditingCode(null);
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className={cn(
                                  "w-16 h-11 text-center text-lg font-bold tabular-nums rounded-lg transition-colors",
                                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  isComplete ? "text-[var(--status-ok-fg)]" : "text-foreground",
                                )}
                                disabled={otherUserHasSession}
                                onClick={() => startInlineEdit(line)}
                                aria-label={`Set quantity for ${line.label}`}
                              >
                                {optimisticActual}
                              </button>
                            )}

                            <span className="text-xs text-muted-foreground w-8 ps-0.5 shrink-0">
                              /{line.expected}
                            </span>

                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-11 w-11 rounded-xl shrink-0"
                              disabled={otherUserHasSession || pendingOps > 0}
                              onClick={() => scanLine(line.itemId, line.code, line.label, { kind: "relative", delta: +1 })}
                              aria-label={`Increment ${line.label}`}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                            {line.expected > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-11 w-11 rounded-xl shrink-0 text-[var(--action)] border-[var(--action-border)]"
                                disabled={otherUserHasSession || optimisticActual >= line.expected}
                                onClick={() => scanLine(line.itemId, line.code, line.label, { kind: "absolute", observedQuantity: line.expected })}
                                aria-label={`Full restock ${line.label}`}
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Last session summary */}
              {sessionState.lastSummary && (
                <div className="mx-4 my-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm space-y-0.5">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <CheckCircle2 className="w-4 h-4 text-[var(--status-ok-fg)]" />
                    {p.lastSessionTitle}
                  </div>
                  <p className="text-muted-foreground">
                    {p.lastSessionAdded(sessionState.lastSummary.totalAdded)}
                  </p>
                  <p className="text-muted-foreground">
                    {p.lastSessionRemoved(sessionState.lastSummary.totalRemoved)}
                  </p>
                  <p className={cn("font-medium", sessionState.lastSummary.itemsMissingCount > 0 ? "text-[var(--status-stale-fg)]" : "text-[var(--status-ok-fg)]")}>
                    {p.lastSessionMissing(sessionState.lastSummary.itemsMissingCount)}
                  </p>
                </div>
              )}

              {/* Finish button */}
              {isRestocking && (
                <div className="p-4 border-t sticky bottom-0 bg-card/95 backdrop-blur">
                  <Button
                    type="button"
                    variant="action"
                    size="lg"
                    className="w-full text-base shadow"
                    onClick={finishSession}
                    loading={finishMut.isPending}
                  >
                    {missingCount === 0
                      ? p.finishRestock
                      : p.finishRestockWithMissing(missingCount)}
                  </Button>
                </div>
              )}

            </CardContent>
          </Card>
        )}
      </div>

      {/* Scan overlay (transient toast — stays fixed by design, not a control) */}
      {scanOverlay && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-28 z-[85] flex justify-center px-4 md:bottom-32"
          aria-live="polite"
        >
          <div
            className={cn(
              "flex max-w-[min(92vw,24rem)] items-center gap-3 rounded-2xl px-6 py-4 shadow-2xl animate-in fade-in zoom-in",
              scanOverlay.delta !== null
                ? "bg-[var(--action)] text-[var(--action-foreground)]"
                : "bg-destructive text-destructive-foreground border border-destructive/50",
            )}
          >
            <span className="text-2xl font-bold tabular-nums shrink-0">
              {scanOverlay.delta === null
                ? "!"
                : scanOverlay.delta > 0
                  ? `+${scanOverlay.delta}`
                  : `${scanOverlay.delta}`}
            </span>
            <span className="text-base font-semibold leading-snug">{scanOverlay.label}</span>
          </div>
        </div>
      )}

      {dispenseContainerId && (
        <DispenseSheet
          containerId={dispenseContainerId}
          isOpen={dispenseOpen}
          onClose={handleCloseDispense}
        />
      )}

    </>
  );
  return <AppShell title={p.title}>{pageContent}</AppShell>;
}