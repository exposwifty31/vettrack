/**
 * R-RTC-1.5 — ephemeral presence store (socket-lease based, reference-counted).
 *
 * Mirrors the `display-heartbeat-store` pattern: short-TTL leases, bounded
 * in-process Map fallback, no DB, no persistent identity, bounded payload
 * (userId + display name only). Presence for a user in a room is held by one lease
 * PER SOCKET; a user remains present until ALL their leases in that room expire or
 * disconnect — so one socket disconnecting never removes a user who has another
 * socket still active.
 *
 * This is the per-instance presence view. Across instances it converges because
 * join/leave events fan out through the Socket.io Redis adapter (configured in the
 * server init); each instance's store receives the same events. When Redis is
 * present, leases are ALSO best-effort mirrored with TTL so a crashed instance's
 * leases self-expire.
 */
import { getRedis } from "../redis.js";
import {
  COLLAB_REDIS_PREFIX,
  PRESENCE_TTL_MS,
  FALLBACK_MAP_MAX_ROOMS,
  FALLBACK_MAP_MAX_LEASES_PER_ROOM,
} from "./config.js";

export interface PresenceMember {
  userId: string;
  displayName: string;
}

interface Lease {
  socketId: string;
  userId: string;
  displayName: string;
  expiresAtMs: number;
}

export interface PresenceStore {
  /** Add/refresh a lease for (room, socket). Returns true if this made the user newly present. */
  addLease(room: string, member: PresenceMember, socketId: string): boolean;
  /** Refresh a lease's TTL (heartbeat). No-op if the lease is gone. */
  touch(room: string, socketId: string): void;
  /** Remove one socket's lease. Returns true if the user is now fully absent from the room. */
  removeLease(room: string, socketId: string): boolean;
  /** Current present members (deduped by userId, expired leases pruned). */
  getPresent(room: string): PresenceMember[];
  /** Total lease count (bounded-growth assertion for tests). */
  size(): number;
}

export interface PresenceStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

/**
 * Create an in-process presence store. `now` is injectable for deterministic TTL
 * tests. Bounded: at most FALLBACK_MAP_MAX_ROOMS rooms and
 * FALLBACK_MAP_MAX_LEASES_PER_ROOM leases per room (excess joins are dropped —
 * ephemeral presence loss under overload is acceptable, never an error).
 */
export function createPresenceStore(opts: PresenceStoreOptions = {}): PresenceStore {
  const now = opts.now ?? (() => Date.now());
  const ttlMs = opts.ttlMs ?? PRESENCE_TTL_MS;
  // room -> socketId -> Lease
  const rooms = new Map<string, Map<string, Lease>>();

  function pruneRoom(leases: Map<string, Lease>): void {
    const t = now();
    for (const [socketId, lease] of leases) {
      if (lease.expiresAtMs <= t) leases.delete(socketId);
    }
  }

  function userPresent(leases: Map<string, Lease>, userId: string): boolean {
    for (const lease of leases.values()) {
      if (lease.userId === userId) return true;
    }
    return false;
  }

  return {
    addLease(room, member, socketId) {
      let leases = rooms.get(room);
      if (!leases) {
        if (rooms.size >= FALLBACK_MAP_MAX_ROOMS) return false; // bounded: drop
        leases = new Map();
        rooms.set(room, leases);
      }
      pruneRoom(leases);
      const wasPresent = userPresent(leases, member.userId);
      if (!leases.has(socketId) && leases.size >= FALLBACK_MAP_MAX_LEASES_PER_ROOM) {
        return false; // bounded: drop excess lease
      }
      leases.set(socketId, {
        socketId,
        userId: member.userId,
        displayName: member.displayName,
        expiresAtMs: now() + ttlMs,
      });
      return !wasPresent;
    },

    touch(room, socketId) {
      const leases = rooms.get(room);
      const lease = leases?.get(socketId);
      if (lease) lease.expiresAtMs = now() + ttlMs;
    },

    removeLease(room, socketId) {
      const leases = rooms.get(room);
      if (!leases) return false;
      const lease = leases.get(socketId);
      if (!lease) return false;
      const { userId } = lease;
      leases.delete(socketId);
      pruneRoom(leases);
      const stillPresent = userPresent(leases, userId);
      if (leases.size === 0) rooms.delete(room);
      return !stillPresent;
    },

    getPresent(room) {
      const leases = rooms.get(room);
      if (!leases) return [];
      pruneRoom(leases);
      const byUser = new Map<string, PresenceMember>();
      for (const lease of leases.values()) {
        if (!byUser.has(lease.userId)) {
          byUser.set(lease.userId, { userId: lease.userId, displayName: lease.displayName });
        }
      }
      return [...byUser.values()];
    },

    size() {
      let total = 0;
      for (const leases of rooms.values()) total += leases.size;
      return total;
    },
  };
}

/**
 * Best-effort Redis mirror of a lease (crashed-instance cleanup). Never throws —
 * presence is ephemeral and Redis absence is a supported degraded mode.
 */
export async function mirrorLeaseToRedis(room: string, socketId: string, ttlMs = PRESENCE_TTL_MS): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.set(`${COLLAB_REDIS_PREFIX}lease:${room}:${socketId}`, "1", "PX", ttlMs);
  } catch {
    /* ephemeral — ignore */
  }
}
