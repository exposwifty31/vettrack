import { useCallback, useEffect, useState } from "react";
import { isCollabConnected } from "@/lib/collab-socket";
import { useCollabRoom, type CollabRoomBinding } from "@/features/collab/useCollabRoom";

/**
 * R-RTC-1.4 · Feature 3 — wires the EPHEMERAL + STRICTLY ADVISORY collaboration
 * channel into a record detail (equipment / inventory item): "who is viewing /
 * editing this record".
 *
 * The SHARED socket lifecycle (lazy connect, fresh-token handshake, re-join on
 * reconnect, presence room-filter, graceful degradation, ref-count release) lives
 * in `useCollabRoom`; this hook layers ONLY the record's own logic on top:
 *  - STRICTLY ADVISORY: this hook exposes co-presence ONLY. It NEVER locks,
 *    blocks, or alters an edit — there is no "locked" output and no gate. The
 *    server OCC/version guard remains the SOLE conflict authority.
 *  - The client sends the record binding ONLY in the join room request
 *    ({ kind:"record", recordType, recordId }); the ongoing `record-presence`
 *    emit carries the INTENT ONLY ({ editing }). The server derives recordType +
 *    recordId from the authorized room membership and attaches userId from the DB
 *    session — the client never sends a trusted recordId/recordType nor a userId.
 *  - Degrades to inert (no indicator, no emit) with no token / no recordId.
 */

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

  // Peers whose LAST intent was "editing". Resolved against presentMembers so a
  // departed peer (dropped from presence) is excluded even before an explicit
  // viewing/off — advisory only, never a lock.
  const [peerEditingIds, setPeerEditingIds] = useState<string[]>([]);

  const active = enabled && !!recordId;

  const bindEvents = useCallback(({ on }: CollabRoomBinding) => {
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

    on("peer-record", handlePeerRecord);

    return () => {
      setPeerEditingIds([]);
    };
  }, []);

  const { isConnected, isJoined, presentMembers, socketRef } = useCollabRoom({
    enabled: active,
    joinRequest: { kind: "record", recordType, recordId },
    bindEvents,
  });

  // Emit the local INTENT ({ editing } ONLY) once joined and whenever it flips.
  // One emit per (joined, editing) transition — deterministic and advisory.
  useEffect(() => {
    const socket = socketRef.current;
    if (!active || !socket || !isCollabConnected() || !isJoined) return;
    socket.emit("record-presence", { editing }); // NO userId / recordId — server derives both
  }, [active, isJoined, editing, socketRef]);

  // Resolve editing peers against present members: excludes self (peer-record is
  // peer-only) and any peer who has left the record. Advisory list only.
  const peerEditors = presentMembers.filter((m) => peerEditingIds.includes(m.userId));

  return { isConnected, presentMembers, peerEditors };
}
