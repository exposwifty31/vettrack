import type { RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, idempotencyKeys } from "../db.js";
import {
  buildEquipmentReplayStorageKey,
  hashEquipmentReplayRequest,
} from "../lib/equipment-replay-idempotency.js";
import { incrementMetric } from "../lib/metrics.js";

/** Structured equipment replay idempotency events (telemetry only). */
export const logger = {
  info(fields: {
    event: "replay_idempotency_collision";
    route: string;
    outcome: string;
  }): void {
    console.info("[equipment-replay-idempotency]", fields);
  },
};

/** Plain JSON snapshot suitable for jsonb replay (dates → ISO strings, etc.). */
function snapshotResponseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

async function persistEquipmentReplayResponse(params: {
  clinicId: string;
  storageKey: string;
  endpoint: string;
  requestHash: string;
  statusCode: number;
  responseBody: Record<string, unknown>;
}): Promise<void> {
  await db
    .insert(idempotencyKeys)
    .values({
      clinicId: params.clinicId,
      key: params.storageKey,
      endpoint: params.endpoint,
      requestHash: params.requestHash,
      statusCode: params.statusCode,
      responseBody: params.responseBody,
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.clinicId, idempotencyKeys.key],
      set: {
        endpoint: params.endpoint,
        requestHash: params.requestHash,
        statusCode: params.statusCode,
        responseBody: params.responseBody,
      },
    });
}

/**
 * Await idempotency persist, then invoke the real sender. Returns `res` immediately so
 * Express's synchronous Send/json typings are satisfied; the HTTP body is still emitted
 * only after persist completes (or fail-open on persist error).
 */
function schedulePersistThenSend(
  res: Response,
  persisted: { value: boolean },
  persist: () => Promise<void>,
  send: () => Response,
): Response {
  if (persisted.value) {
    return send();
  }
  persisted.value = true;
  void persist()
    .then(() => {
      send();
    })
    .catch((err: unknown) => {
      console.error("[equipment-replay-idempotency] persist failed", err);
      send();
    });
  return res;
}

/**
 * In-flight same-key gates. The lookup→execute→persist window below is not
 * atomic: two concurrent requests carrying the SAME Idempotency-Key can both
 * miss the stored row and both run the handler — on a toggle route the second
 * run reverses the first. Chaining same-key requests through this map closes
 * that window inside one process (the deployment is single-instance); a
 * cross-instance duplicate is still caught by the stored-row hash check once
 * the first response persists. Adding a second replica re-opens the window —
 * at that point the claim must move into vt_idempotency_keys (a pending row
 * reserved before next()), not stay in this map. Entries are deleted when their chain drains,
 * so the map is bounded by concurrently in-flight keyed requests.
 */
const inFlightReplayGates = new Map<string, Promise<void>>();

/**
 * Optional offline replay idempotency for equipment mutations.
 * When `Idempotency-Key` is absent, the request proceeds unchanged (online callers).
 */
export function equipmentReplayIdempotency(endpoint: string): RequestHandler {
  return async (req, res, next) => {
    const raw = req.headers["idempotency-key"];
    const headerKey = typeof raw === "string" ? raw.trim() : "";
    if (!headerKey) {
      next();
      return;
    }

    const clinicId = req.clinicId?.trim();
    const userId = req.authUser?.id?.trim();
    if (!clinicId || !userId) {
      res.status(400).json({
        code: "VALIDATION_FAILED",
        error: "VALIDATION_FAILED",
        reason: "CLINIC_AND_USER_REQUIRED",
        message: "Clinic and authenticated user required for idempotent equipment replay",
      });
      return;
    }

    const storageKey = buildEquipmentReplayStorageKey(userId, headerKey);
    const requestHash = hashEquipmentReplayRequest(
      req.method,
      req.originalUrl || req.url,
      req.body,
    );

    const gateKey = `${clinicId}:${storageKey}`;
    let settleGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      settleGate = resolve;
    });
    const prior = inFlightReplayGates.get(gateKey) ?? Promise.resolve();
    const chainTail = prior.then(() => gate);
    inFlightReplayGates.set(gateKey, chainTail);
    let gateReleased = false;
    const releaseGate = () => {
      if (gateReleased) {
        return;
      }
      gateReleased = true;
      settleGate();
      if (inFlightReplayGates.get(gateKey) === chainTail) {
        inFlightReplayGates.delete(gateKey);
      }
    };
    await prior;

    try {
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.clinicId, clinicId), eq(idempotencyKeys.key, storageKey)))
        .limit(1);

      if (existing) {
        if (existing.requestHash !== requestHash) {
          logger.info({
            event: "replay_idempotency_collision",
            route: endpoint,
            outcome: "IDEMPOTENCY_KEY_BODY_MISMATCH",
          });
          incrementMetric("replay_idempotency_collision");
          res.status(409).json({
            code: "IDEMPOTENCY_CONFLICT",
            error: "IDEMPOTENCY_CONFLICT",
            reason: "IDEMPOTENCY_KEY_BODY_MISMATCH",
            message: "Idempotency-Key was reused with a different request body",
          });
          releaseGate();
          return;
        }
        incrementMetric("offline_sync_idempotency_replay_served");
        if (existing.statusCode === 204) {
          res.status(204).send();
          releaseGate();
          return;
        }
        res.status(existing.statusCode).json(existing.responseBody);
        releaseGate();
        return;
      }
    } catch (err) {
      console.error("[equipment-replay-idempotency] lookup failed", err);
      res.status(503).json({
        code: "SERVICE_UNAVAILABLE",
        error: "SERVICE_UNAVAILABLE",
        reason: "IDEMPOTENCY_STORE_UNAVAILABLE",
        message: "Could not verify idempotency; try again",
      });
      releaseGate();
      return;
    }

    const origJson = res.json.bind(res);
    const origSend = res.send.bind(res);
    const persisted = { value: false };

    const persistContext = {
      clinicId,
      storageKey,
      endpoint,
      requestHash,
    };

    const jsonWithReplay: Response["json"] = function jsonWithReplay(body?: unknown) {
      const statusCode = res.statusCode;
      if (statusCode < 200 || statusCode >= 300) {
        return origJson(body);
      }
      if (statusCode === 204) {
        return schedulePersistThenSend(
          res,
          persisted,
          () =>
            persistEquipmentReplayResponse({
              ...persistContext,
              statusCode: 204,
              responseBody: {},
            }),
          () => origJson(body),
        );
      }
      const responseBody = snapshotResponseBody(body);
      if (responseBody === null) {
        return origJson(body);
      }
      return schedulePersistThenSend(
        res,
        persisted,
        () =>
          persistEquipmentReplayResponse({
            ...persistContext,
            statusCode,
            responseBody,
          }),
        () => origJson(body),
      );
    };

    const sendWithReplay: Response["send"] = function sendWithReplay(body) {
      const statusCode = res.statusCode;
      if (statusCode !== 204 || persisted.value) {
        return origSend(body);
      }
      return schedulePersistThenSend(
        res,
        persisted,
        () =>
          persistEquipmentReplayResponse({
            ...persistContext,
            statusCode: 204,
            responseBody: {},
          }),
        () => origSend(body),
      );
    };

    res.json = jsonWithReplay;
    res.send = sendWithReplay;

    // Pass-through: hold the gate until this response has persisted and been
    // sent (finish), or the connection died (close) — whichever comes first.
    // If wiring the hooks (or dispatch itself) throws, release rather than
    // poisoning every later request on this key.
    try {
      res.once("finish", releaseGate);
      res.once("close", releaseGate);
      next();
    } catch (err) {
      releaseGate();
      throw err;
    }
  };
}
