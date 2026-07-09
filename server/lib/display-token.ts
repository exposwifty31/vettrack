// Phase 9 — Display-device pairing token primitives.
//
// Two secrets live here:
//   1. The long-lived DEVICE TOKEN (`vtd_<32 random bytes base64url>`), minted
//      once at pair/claim time and returned to the device exactly once. Only its
//      sha256 hex hash (`hashToken`) is ever persisted (vt_display_devices.token_hash).
//   2. A short-lived, single-use PAIRING CODE bound to a clinic. An admin issues
//      one; a headless device claims it to receive a device token. The code is
//      stored with a TTL in Redis (preferred) or a bounded in-process Map
//      fallback, and is consumed atomically so it can be redeemed at most once.
//
// No raw device token is ever logged or stored. No pairing code is ever written
// to the DB. Constant-time comparison is used for hash equality checks.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getRedis, recordRedisFallback, timedRedisOp } from "./redis.js";

// ── Device token ─────────────────────────────────────────────────────────────

export const DISPLAY_TOKEN_PREFIX = "vtd_";
const DISPLAY_TOKEN_RANDOM_BYTES = 32;

/** Mint a fresh device token: `vtd_` + 32 random bytes, base64url-encoded. */
export function mintToken(): string {
  return `${DISPLAY_TOKEN_PREFIX}${randomBytes(DISPLAY_TOKEN_RANDOM_BYTES).toString("base64url")}`;
}

/** sha256 hex of the full token string. Deterministic; safe to store/compare. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** True when a candidate string has the display-token shape (cheap pre-check). */
export function looksLikeDisplayToken(candidate: string): boolean {
  return candidate.startsWith(DISPLAY_TOKEN_PREFIX) && candidate.length > DISPLAY_TOKEN_PREFIX.length;
}

/** Constant-time equality for two same-encoding strings (e.g. two sha256 hexes). */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── Pairing code store ───────────────────────────────────────────────────────

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PAIRING_CODE_LENGTH = 8;
// Crockford-ish alphabet: no 0/O/1/I/L to avoid human transcription errors.
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REDIS_PREFIX = "vettrack:display_pair:";
const FALLBACK_MAP_MAX_SIZE = 5_000;

type PairingEntry = {
  clinicId: string;
  expiresAtMs: number;
};

// Bounded in-process fallback used only when Redis is unavailable.
const fallbackMap = new Map<string, PairingEntry>();

// Atomic get-and-delete so a code is redeemable at most once even under a race.
const CONSUME_LUA = `
local v = redis.call("GET", KEYS[1])
if v then redis.call("DEL", KEYS[1]) end
return v
`;

function nowMs(): number {
  return Date.now();
}

/** Generate a high-entropy human-enterable code (~40 bits over the alphabet). */
function generateCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    out += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return out;
}

/** Uppercase and strip anything outside the alphabet (dashes/spaces tolerated on input). */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== PAIRING_CODE_LENGTH) return null;
  return cleaned;
}

function redisKey(code: string): string {
  return `${REDIS_PREFIX}${code}`;
}

function evictFallbackIfNeeded(): void {
  if (fallbackMap.size < FALLBACK_MAP_MAX_SIZE) return;
  const now = nowMs();
  for (const [code, entry] of fallbackMap) {
    if (entry.expiresAtMs <= now) fallbackMap.delete(code);
    if (fallbackMap.size < FALLBACK_MAP_MAX_SIZE) return;
  }
  if (fallbackMap.size >= FALLBACK_MAP_MAX_SIZE) {
    const sorted = [...fallbackMap.entries()].sort((a, b) => a[1].expiresAtMs - b[1].expiresAtMs);
    const toDrop = sorted.slice(0, Math.max(1, Math.floor(FALLBACK_MAP_MAX_SIZE / 10)));
    for (const [code] of toDrop) fallbackMap.delete(code);
  }
}

export interface IssuedPairingCode {
  code: string;
  expiresAt: Date;
}

/**
 * Issue a short-lived, single-use pairing code bound to `clinicId`.
 * Stored in Redis with a TTL (preferred) and always mirrored into the bounded
 * in-process fallback so issue+consume works even without Redis.
 */
export async function issuePairingCode(clinicId: string): Promise<IssuedPairingCode> {
  const code = generateCode();
  const expiresAtMs = nowMs() + PAIRING_CODE_TTL_MS;
  const entry: PairingEntry = { clinicId, expiresAtMs };

  const r = await getRedis();
  if (r) {
    try {
      const ttlSec = Math.ceil(PAIRING_CODE_TTL_MS / 1000);
      await timedRedisOp("displayPair:issue", () =>
        r.set(redisKey(code), JSON.stringify(entry), "EX", ttlSec),
      );
    } catch {
      // best-effort; fallback below still holds the code
    }
  } else {
    recordRedisFallback("displayPair:issue");
  }

  evictFallbackIfNeeded();
  fallbackMap.set(code, entry);
  return { code, expiresAt: new Date(expiresAtMs) };
}

/**
 * Validate and CONSUME a pairing code. Returns the bound clinicId on success, or
 * null if the code is unknown, expired, or already redeemed. Single-use: a
 * second call for the same code always returns null.
 */
export async function consumePairingCode(rawCode: unknown): Promise<string | null> {
  const code = normalizePairingCode(rawCode);
  if (!code) return null;

  const now = nowMs();
  let resolved: PairingEntry | null = null;

  const r = await getRedis();
  if (r) {
    try {
      const raw = await timedRedisOp("displayPair:consume", () =>
        r.eval(CONSUME_LUA, 1, redisKey(code)),
      );
      if (typeof raw === "string") {
        const parsed = JSON.parse(raw) as Partial<PairingEntry>;
        if (typeof parsed.clinicId === "string" && typeof parsed.expiresAtMs === "number") {
          resolved = { clinicId: parsed.clinicId, expiresAtMs: parsed.expiresAtMs };
        }
      }
    } catch {
      // fall through to in-process fallback
    }
  } else {
    recordRedisFallback("displayPair:consume");
  }

  // Always delete from the fallback too (covers Redis-less mode and keeps the
  // two stores from diverging into a double-redeem).
  const fromFallback = fallbackMap.get(code) ?? null;
  fallbackMap.delete(code);
  if (!resolved) resolved = fromFallback;

  if (!resolved) return null;
  if (resolved.expiresAtMs <= now) return null;
  return resolved.clinicId;
}

/** Test-only — clear in-memory pairing state between test cases. */
export function _resetPairingCodeStoreForTests(): void {
  fallbackMap.clear();
}
