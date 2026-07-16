/**
 * R-RTC-1.6 — thin, lazy `socket.io-client` wrapper for the collaboration channel.
 *
 * Connected LAZILY only on surfaces that use it (shift-chat panel, `/board`,
 * record-detail) — never app-wide. Auto-reconnect. Graceful degradation is the
 * caller's contract: if the socket never connects (Capacitor native, restrictive
 * network, channel disabled) the using surface simply shows no peer signals —
 * NO core action is ever gated on this socket.
 *
 * Identity is server-attached from the DB session; this client sends only the
 * bearer token (and, in dev-bypass, the role override) in `auth`. It never claims
 * a userId — the server ignores client-claimed identity.
 */
import { io, type Socket } from "socket.io-client";

const COLLAB_PATH = "/collab-ws";

export interface CollabAuth {
  /** Clerk session token (bearer). In dev-bypass any non-empty placeholder works. */
  token: string;
  /** Dev-bypass overrides — ignored by the server unless it is in dev-bypass mode. */
  dev?: { role?: string; userId?: string; clinicId?: string };
}

let socket: Socket | null = null;

/**
 * Get (lazily creating) the single collaboration socket. Returns null if no auth
 * token is available — callers must treat null as "degrade, show no peer signals".
 */
export function getCollabSocket(auth: CollabAuth | null, origin: string = window.location.origin): Socket | null {
  if (!auth || !auth.token) return null;
  if (socket) return socket;
  socket = io(origin, {
    path: COLLAB_PATH,
    transports: ["websocket"],
    auth: { token: auth.token, dev: auth.dev },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    autoConnect: true,
  });
  return socket;
}

/** True when a socket exists and is currently connected. */
export function isCollabConnected(): boolean {
  return socket?.connected === true;
}

/** Join a collaboration room; resolves with the ack (or null on no-socket/timeout). */
export function joinCollabRoom(
  s: Socket,
  req: { kind: "chat" } | { kind: "board" } | { kind: "record"; recordType: string; recordId: string },
): Promise<{ ok: boolean; room?: string; members?: { userId: string; displayName: string }[]; reason?: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null); // degrade silently — no peer presence shown
      }
    }, 5_000);
    s.emit("join", req, (ack: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack as never);
    });
  });
}

/** Tear down the collaboration socket (surface unmount / sign-out). */
export function closeCollabSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
