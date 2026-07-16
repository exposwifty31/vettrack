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
 * Cross-instance convergence (the 2-instance topology config REQUIRES Redis for):
 * the Socket.io Redis adapter fans BROADCASTS across instances, but it does NOT
 * share this store's per-socket presence bookkeeping — so a converged member list
 * cannot be computed from the local Map alone. Convergence is achieved HERE: the
 * async `register`/`refresh`/`unregister` methods best-effort mirror each lease to
 * a CLINIC-SCOPED Redis key (`vettrack:collab:lease:<room>:<socketId>`, PX-TTL) and
 * `getConvergedPresent` aggregates the room's whole lease keyspace by SCAN + MGET,
 * merged with the local view and deduped by userId. The mirror follows the
 * `display-heartbeat-store` convention (`recordRedisFallback` / `timedRedisOp`,
 * best-effort, never throws) so a crashed instance's leases self-expire via TTL and
 * Redis absence degrades cleanly to the per-instance local view. The room name
 * embeds the clinicId, so the SCAN keyspace is clinic-scoped — no cross-tenant leak.
 */
import type { Redis } from "ioredis";
import { getRedis, recordRedisFallback, timedRedisOp } from "../redis.js";
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
  /** Add/refresh a lease for (room, socket) in the LOCAL view only. Returns true if this made the user newly present. */
  addLease(room: string, member: PresenceMember, socketId: string): boolean;
  /** Refresh a lease's LOCAL TTL (heartbeat). No-op if the lease is gone. */
  touch(room: string, socketId: string): void;
  /** Remove one socket's LOCAL lease. Returns true if the user is now fully absent from the room. */
  removeLease(room: string, socketId: string): boolean;
  /** Current present members in the LOCAL (per-instance) view (deduped by userId, expired leases pruned). */
  getPresent(room: string): PresenceMember[];
  /** Total local lease count (bounded-growth assertion for tests). */
  size(): number;
  /**
   * Add a lease locally AND best-effort mirror it to the shared Redis lease
   * keyspace so peers on other instances converge. Returns true if newly present
   * locally. Never throws (Redis absence degrades to local-only).
   */
  register(room: string, member: PresenceMember, socketId: string): Promise<boolean>;
  /** Refresh a lease's TTL locally AND in the Redis mirror (heartbeat). Never throws. */
  refresh(room: string, socketId: string): Promise<void>;
  /** Remove a lease locally AND from the Redis mirror. Returns true if now fully absent locally. Never throws. */
  unregister(room: string, socketId: string): Promise<boolean>;
  /**
   * Cross-instance present members: the local view merged with every lease in the
   * room's Redis keyspace (SCAN + MGET), deduped by userId. Falls back to the local
   * view when Redis is unavailable. Clinic-scoped by the room name — never leaks
   * across tenants. Never throws.
   */
  getConvergedPresent(room: string): Promise<PresenceMember[]>;
}

export interface PresenceStoreOptions {
  now?: () => number;
  ttlMs?: number;
  /** Redis key prefix for mirrored leases (defaults to COLLAB_REDIS_PREFIX). */
  redisPrefix?: string;
  /** Injectable Redis client factory (defaults to the shared getRedis). */
  getRedisClient?: () => Promise<Redis | null>;
}

interface RedisLeaseValue {
  userId: string;
  displayName: string;
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
  const redisPrefix = opts.redisPrefix ?? COLLAB_REDIS_PREFIX;
  const getRedisClient = opts.getRedisClient ?? getRedis;
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

  // ── LOCAL (per-instance) lease bookkeeping ──────────────────────────────────
  function addLeaseLocal(room: string, member: PresenceMember, socketId: string): boolean {
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
  }

  function touchLocal(room: string, socketId: string): void {
    const leases = rooms.get(room);
    const lease = leases?.get(socketId);
    if (lease) lease.expiresAtMs = now() + ttlMs;
  }

  function removeLeaseLocal(room: string, socketId: string): boolean {
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
  }

  function getPresentLocal(room: string): PresenceMember[] {
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
  }

  function hasLeaseLocal(room: string, socketId: string): boolean {
    return rooms.get(room)?.has(socketId) ?? false;
  }

  // ── REDIS mirror (best-effort, never throws; converges across instances) ─────
  const leaseKey = (room: string, socketId: string): string => `${redisPrefix}lease:${room}:${socketId}`;
  const leasePattern = (room: string): string => `${redisPrefix}lease:${room}:*`;

  async function writeLease(room: string, member: PresenceMember, socketId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) {
        recordRedisFallback("collabPresence:write");
        return;
      }
      const value: RedisLeaseValue = { userId: member.userId, displayName: member.displayName };
      await timedRedisOp("collabPresence:write", () =>
        redis.set(leaseKey(room, socketId), JSON.stringify(value), "PX", ttlMs),
      );
    } catch {
      /* ephemeral — presence loss under a Redis hiccup is acceptable, never an error */
    }
  }

  async function deleteLease(room: string, socketId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) {
        recordRedisFallback("collabPresence:del");
        return;
      }
      await timedRedisOp("collabPresence:del", () => redis.del(leaseKey(room, socketId)));
    } catch {
      /* ephemeral — ignore */
    }
  }

  async function scanLeaseKeys(redis: Redis, pattern: string): Promise<string[]> {
    const out: string[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await timedRedisOp("collabPresence:scan", () =>
        redis.scan(cursor, "MATCH", pattern, "COUNT", 100),
      );
      cursor = next;
      out.push(...keys);
      // Bound the read the same way the in-process fallback is bounded.
      if (out.length >= FALLBACK_MAP_MAX_LEASES_PER_ROOM) return out.slice(0, FALLBACK_MAP_MAX_LEASES_PER_ROOM);
    } while (cursor !== "0");
    return out;
  }

  async function getConvergedPresent(room: string): Promise<PresenceMember[]> {
    const byUser = new Map<string, PresenceMember>();
    for (const m of getPresentLocal(room)) byUser.set(m.userId, m);

    let redis: Redis | null = null;
    try {
      redis = await getRedisClient();
    } catch {
      redis = null;
    }
    if (!redis) {
      recordRedisFallback("collabPresence:converged");
      return [...byUser.values()];
    }

    try {
      const keys = await scanLeaseKeys(redis, leasePattern(room));
      if (keys.length > 0) {
        const values = await timedRedisOp("collabPresence:mget", () => redis!.mget(...keys));
        for (const raw of values) {
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as Partial<RedisLeaseValue>;
            if (typeof parsed.userId === "string" && typeof parsed.displayName === "string") {
              if (!byUser.has(parsed.userId)) {
                byUser.set(parsed.userId, { userId: parsed.userId, displayName: parsed.displayName });
              }
            }
          } catch {
            /* skip a malformed lease value */
          }
        }
      }
      return [...byUser.values()];
    } catch {
      recordRedisFallback("collabPresence:converged");
      return [...byUser.values()];
    }
  }

  return {
    addLease: addLeaseLocal,
    touch: touchLocal,
    removeLease: removeLeaseLocal,
    getPresent: getPresentLocal,
    size() {
      let total = 0;
      for (const leases of rooms.values()) total += leases.size;
      return total;
    },

    async register(room, member, socketId) {
      const newlyPresent = addLeaseLocal(room, member, socketId);
      // Only mirror leases that were actually accepted locally (respect the cap).
      if (hasLeaseLocal(room, socketId)) await writeLease(room, member, socketId);
      return newlyPresent;
    },

    async refresh(room, socketId) {
      const lease = rooms.get(room)?.get(socketId);
      if (!lease) return;
      touchLocal(room, socketId);
      await writeLease(room, { userId: lease.userId, displayName: lease.displayName }, socketId);
    },

    async unregister(room, socketId) {
      const nowAbsent = removeLeaseLocal(room, socketId);
      await deleteLease(room, socketId);
      return nowAbsent;
    },

    getConvergedPresent,
  };
}
