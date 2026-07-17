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
 * async `register`/`refresh`/`unregister` methods best-effort mirror each lease as
 * a MEMBER of a single CLINIC-SCOPED Redis SORTED SET per room
 * (`vettrack:collab:presence:<room>`). Each member encodes `{userId, socketId,
 * displayName}` (so a user stays present while ANY of their sockets' leases live —
 * ref-count preserved) and its SCORE is the lease-expiry timestamp. `register`/
 * `refresh` ZADD (score = now + TTL); `unregister`/disconnect ZREM the member;
 * `getConvergedPresent` ZREMRANGEBYSCORE(-inf, now) to prune expired leases then
 * ZRANGE the live members, merged with the local view and deduped by userId. This
 * is O(members-in-the-room) — it NEVER scans the shared Redis keyspace, so its cost
 * no longer scales with BullMQ/outbox/session keys on a busy clinic (card #4). The
 * mirror follows the `display-heartbeat-store` convention (`recordRedisFallback` /
 * `timedRedisOp`, best-effort, never throws). Each write ALSO re-arms a best-effort
 * key-level TTL (`PEXPIRE`, lease TTL + margin) on the room's ZSET, so a crashed
 * instance's leases self-expire two ways: a room still being read has expired members
 * pruned on the next read (ZREMRANGEBYSCORE); a room that is ABANDONED (never read
 * again) has its whole ZSET key auto-deleted by Redis when the TTL lapses — it does
 * NOT linger on the shared keyspace.
 * Redis absence degrades cleanly to the per-instance local view. The room name
 * embeds the clinicId, so the ZSET key is clinic-scoped — no cross-tenant leak.
 */
import type { Redis } from "ioredis";
import { getRedis, recordRedisFallback, timedRedisOp } from "../redis.js";
import {
  COLLAB_REDIS_PREFIX,
  PRESENCE_TTL_MS,
  PRESENCE_KEY_EXPIRE_MARGIN_MS,
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
   * Cross-instance present members: the local view merged with the room's shared
   * Redis sorted set (ZREMRANGEBYSCORE prune + ZRANGE live members), deduped by
   * userId. O(members-in-room) — never scans the shared keyspace. Falls back to the
   * local view when Redis is unavailable. Clinic-scoped by the room name — never
   * leaks across tenants. Never throws.
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

interface RedisMemberValue {
  userId: string;
  socketId: string;
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

  // Reclaim GHOST rooms: rooms whose leases all lapsed by TTL without an explicit
  // disconnect (network stall / reconnect churn / a sole-lease record room expiring).
  // removeLeaseLocal deletes an empty room only on an explicit disconnect, so without
  // this sweep those rooms linger in `rooms` forever; once FALLBACK_MAP_MAX_ROOMS of
  // them accumulate, addLeaseLocal would reject EVERY new room. O(rooms) — invoked
  // only at the cap boundary, never on the hot path.
  function sweepEmptyRooms(): void {
    for (const [room, leases] of rooms) {
      pruneRoom(leases);
      if (leases.size === 0) rooms.delete(room);
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
      if (rooms.size >= FALLBACK_MAP_MAX_ROOMS) {
        // At the cap: first reclaim ghost rooms (leases lapsed by TTL, never
        // disconnected). Only if genuinely full afterwards do we drop the join.
        sweepEmptyRooms();
        if (rooms.size >= FALLBACK_MAP_MAX_ROOMS) return false; // bounded: drop
      }
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
    // Reclaim on read: a room whose sole lease just lapsed by TTL is now empty and
    // must not linger as a ghost occupying a slot against FALLBACK_MAP_MAX_ROOMS.
    if (leases.size === 0) {
      rooms.delete(room);
      return [];
    }
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
  // One clinic-scoped SORTED SET per room. Members are per-socket leases (so a user
  // stays present while ANY of their sockets' leases live); the score is the lease
  // expiry timestamp, so pruning is a single ranged ZSET op — never a keyspace scan.
  const presenceKey = (room: string): string => `${redisPrefix}presence:${room}`;

  // Deterministic member serialization (fixed key order → ZADD and ZREM produce the
  // byte-identical member string for the same socket lease).
  function leaseMember(userId: string, socketId: string, displayName: string): string {
    const value: RedisMemberValue = { userId, socketId, displayName };
    return JSON.stringify(value);
  }

  async function writeLease(room: string, member: PresenceMember, socketId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) {
        recordRedisFallback("collabPresence:write");
        return;
      }
      const key = presenceKey(room);
      const score = now() + ttlMs;
      const m = leaseMember(member.userId, socketId, member.displayName);
      await timedRedisOp("collabPresence:write", async () => {
        await redis.zadd(key, score, m);
        // Best-effort key-level TTL alongside the ZADD (re-armed on every write /
        // heartbeat). Without it, an ABANDONED room — a crashed / ungraceful instance
        // whose members are never ZREM'd and whose ZSET is never read again (plausible
        // for the many per-equipment record-presence rooms) — would persist forever on
        // the SHARED Redis, re-introducing the very keyspace pollution this store
        // removed. The margin keeps the key alive strictly longer than its newest
        // member's expiry score, so read-time ZREMRANGEBYSCORE still governs membership
        // within the key's life. Mirrors the self-expiring `SET … PX/EX` convention of
        // the per-key store this replaced and of display-heartbeat-store.
        if (typeof redis.pexpire === "function") {
          await redis.pexpire(key, ttlMs + PRESENCE_KEY_EXPIRE_MARGIN_MS);
        }
      });
    } catch {
      /* ephemeral — presence loss under a Redis hiccup is acceptable, never an error */
    }
  }

  async function deleteLease(
    room: string,
    socketId: string,
    userId: string,
    displayName: string,
  ): Promise<void> {
    try {
      const redis = await getRedisClient();
      if (!redis) {
        recordRedisFallback("collabPresence:del");
        return;
      }
      const m = leaseMember(userId, socketId, displayName);
      await timedRedisOp("collabPresence:del", () => redis.zrem(presenceKey(room), m));
    } catch {
      /* ephemeral — ignore */
    }
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
      const key = presenceKey(room);
      // Prune expired leases (score = expiry <= now) with a single ranged ZSET op…
      await timedRedisOp("collabPresence:prune", () => redis!.zremrangebyscore(key, "-inf", now()));
      // …then read the live members. Bounded the same way the in-process fallback is.
      const members = await timedRedisOp("collabPresence:range", () =>
        redis!.zrange(key, 0, FALLBACK_MAP_MAX_LEASES_PER_ROOM - 1),
      );
      for (const raw of members) {
        try {
          const parsed = JSON.parse(raw) as Partial<RedisMemberValue>;
          if (typeof parsed.userId === "string" && typeof parsed.displayName === "string") {
            if (!byUser.has(parsed.userId)) {
              byUser.set(parsed.userId, { userId: parsed.userId, displayName: parsed.displayName });
            }
          }
        } catch {
          /* skip a malformed member */
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
      // Capture the lease's identity BEFORE local removal — the ZSET member string is
      // derived from (userId, socketId, displayName), so ZREM needs it. If the lease
      // was never accepted locally (cap), there is nothing mirrored to remove; a
      // lease whose local copy already expired self-heals via the read-time prune.
      const lease = rooms.get(room)?.get(socketId);
      const nowAbsent = removeLeaseLocal(room, socketId);
      if (lease) await deleteLease(room, socketId, lease.userId, lease.displayName);
      return nowAbsent;
    },

    getConvergedPresent,
  };
}
