import { useEffect, useRef, useState } from "react";
import {
  getCollabSocket,
  isCollabConnected,
  joinCollabRoom,
  leaveCollabRoom,
  releaseCollabSocket,
  type CollabAuthSource,
  type CollabSocket,
} from "@/lib/collab-socket";
import { resolveBearerToken } from "@/lib/auth-fetch";

/**
 * R-RTC-1.4 · Feature 3 — wires the EPHEMERAL + STRICTLY ADVISORY collaboration
 * channel into a record detail (equipment / inventory item): "who is viewing /
 * editing this record".
 *
 * FROZEN guardrails honoured here:
 *  - STRICTLY ADVISORY: this hook exposes co-presence ONLY. It NEVER locks,
 *    blocks, or alters an edit — there is no "locked" output and no gate. The
 *    server OCC/version guard remains the SOLE conflict authority.
 *  - LAZY connect: the ref-counted socket is acquired only while the detail is
 *    mounted and released on unmount — never app-wide.
 *  - GRACEFUL DEGRADATION: when the socket is unavailable (no token / not
 *    connected / no recordId) this hook is inert — the detail renders + edits
 *    EXACTLY as today with no indicator. Nothing about the record is gated on it.
 *  - The client sends the record binding ONLY in the join room request
 *    ({ kind:"record", recordType, recordId }); the ongoing `record-presence`
 *    emit carries the INTENT ONLY ({ editing }). The server derives recordType +
 *    recordId from the authorized room membership and attaches userId from the DB
 *    session — the client never sends a trusted recordId/recordType nor a userId.
 *  - FRESH token: the handshake token is minted from the SAME getter `authFetch`
 *    uses (`resolveBearerToken` → the Clerk getter), re-read on every (re)connect
 *    and refreshed on a cadence below the token TTL — a rolled-over token is never
 *    replayed under the infinite-reconnect loop.
 */

// Re-mint the handshake token below the Clerk session-token TTL (~60s).
const TOKEN_REFRESH_MS = 45_000;

export interface RecordPresenceMember {
  userId: string;
  displayName: string;
}

export interface RecordPresenceState {
  isConnected: boolean;
  presentMembers: RecordPresenceMember[];
  /** Peers currently EDITING this record, names resolved from presence. Advisory. */
  peerEditors: RecordPresenceMember[];
}

export interface UseRecordPresenceOptions {
  recordType: string;
  recordId: string;
  /** Acquire the socket only while the detail is mounted (lazy). Default true. */
  enabled?: boolean;
  /** Local editing intent — mount defaults to viewing; flip true when editing. */
  editing?: boolean;
}

export function useRecordPresence(options: UseRecordPresenceOptions): RecordPresenceState {
  const { recordType, recordId, enabled = true, editing = false } = options;

  const socketRef = useRef<CollabSocket | null>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [presentMembers, setPresentMembers] = useState<RecordPresenceMember[]>([]);
  // Peers whose LAST intent was "editing". Resolved against presentMembers so a
  // departed peer (dropped from presence) is excluded even before an explicit
  // viewing/off — advisory only, never a lock.
  const [peerEditingIds, setPeerEditingIds] = useState<string[]>([]);

  const active = enabled && !!recordId;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let acquired: CollabSocket | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const authSource: CollabAuthSource = () =>
      tokenRef.current ? { token: tokenRef.current } : null;

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    const handlePresence = (payload: { room: string; members: RecordPresenceMember[] }) => {
      setPresentMembers(Array.isArray(payload?.members) ? payload.members : []);
    };

    const handlePeerRecord = (payload: { userId: string; mode: "editing" | "viewing" }) => {
      const userId = payload?.userId;
      if (!userId) return;
      setPeerEditingIds((prev) => {
        if (payload.mode === "editing") {
          return prev.includes(userId) ? prev : [...prev, userId];
        }
        return prev.filter((id) => id !== userId);
      });
    };

    const connect = () => {
      if (cancelled) return;
      const socket = getCollabSocket(authSource);
      if (!socket) return; // degrade — no token / channel unavailable
      acquired = socket;
      socketRef.current = socket;

      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on("presence", handlePresence);
      socket.on("peer-record", handlePeerRecord);
      if (isCollabConnected()) setIsConnected(true);

      void joinCollabRoom(socket, { kind: "record", recordType, recordId }).then((ack) => {
        if (cancelled) return;
        if (ack?.ok) {
          if (ack.room) joinedRoomRef.current = ack.room;
          if (ack.members) setPresentMembers(ack.members);
          setJoined(true);
        }
      });
    };

    // Mint a FRESH token before the first connect, then re-mint on a cadence so the
    // shared socket's infinite reconnects always read a valid token.
    void resolveBearerToken().then((token) => {
      if (cancelled) return;
      tokenRef.current = token;
      connect();
    });
    refreshTimer = setInterval(() => {
      void resolveBearerToken().then((token) => {
        if (!cancelled) tokenRef.current = token;
      });
    }, TOKEN_REFRESH_MS);

    return () => {
      cancelled = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (acquired) {
        acquired.off("connect", handleConnect);
        acquired.off("disconnect", handleDisconnect);
        acquired.off("presence", handlePresence);
        acquired.off("peer-record", handlePeerRecord);
        if (joinedRoomRef.current) leaveCollabRoom(acquired, joinedRoomRef.current);
        // Only release when a socket was actually acquired — a null (degraded)
        // getCollabSocket must NOT be paired with a release.
        releaseCollabSocket();
      }
      joinedRoomRef.current = null;
      socketRef.current = null;
      tokenRef.current = null;
      setJoined(false);
      setIsConnected(false);
      setPresentMembers([]);
      setPeerEditingIds([]);
    };
  }, [active, recordType, recordId]);

  // Emit the local INTENT ({ editing } ONLY) once joined and whenever it flips.
  // One emit per (joined, editing) transition — deterministic and advisory.
  useEffect(() => {
    const socket = socketRef.current;
    if (!active || !joined || !socket || !isCollabConnected()) return;
    socket.emit("record-presence", { editing }); // NO userId / recordId — server derives both
  }, [active, joined, editing]);

  // Resolve editing peers against present members: excludes self (peer-record is
  // peer-only) and any peer who has left the record. Advisory list only.
  const peerEditors = presentMembers.filter((m) => peerEditingIds.includes(m.userId));

  return { isConnected, presentMembers, peerEditors };
}
