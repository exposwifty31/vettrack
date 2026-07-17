import { createHmac } from "crypto";
import express from "express";
import http, { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/db.js", () => ({ db: {} }));

const mockGetCredentials = vi.fn();
vi.mock("../server/integrations/credential-manager.js", () => ({
  getCredentials: (...args: unknown[]) => mockGetCredentials(...args),
}));

const mockIsEnabled = vi.fn();
vi.mock("../server/lib/rfid/config.js", () => ({
  isRfidIngestEnabled: (...args: unknown[]) => mockIsEnabled(...args),
}));

const mockIngest = vi.fn();
vi.mock("../server/lib/rfid-ingest.js", () => ({
  ingestRfidBatch: (...args: unknown[]) => mockIngest(...args),
  RfidDirectionalRejection: class RfidDirectionalRejection extends Error {
    code = "RFID_DIRECTIONAL_UNRESOLVABLE";
  },
}));

import rfidRoutes from "../server/routes/rfid.js";

const SECRET = "test-rfid-secret";
const CLINIC = "dev-clinic-default";

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function buildApp() {
  const app = express();
  app.use("/api/rfid", express.raw({ type: () => true, limit: "512kb" }), rfidRoutes);
  return app;
}

let server: Server;
let baseUrl: string;

async function postRfid(
  body: Buffer,
  headers: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL(`${baseUrl}/api/rfid/events`);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": String(body.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: Record<string, unknown> = {};
          if (text) {
            try {
              json = JSON.parse(text) as Record<string, unknown>;
            } catch {
              json = { raw: text };
            }
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

describe("POST /api/rfid/events", () => {
  beforeAll(() => {
    server = createServer(buildApp());
    return new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    mockGetCredentials.mockReset();
    mockIsEnabled.mockReset();
    mockIngest.mockReset();
    mockGetCredentials.mockResolvedValue({ webhook_secret: SECRET });
    mockIsEnabled.mockResolvedValue(true);
    mockIngest.mockResolvedValue({
      accepted: 1,
      updated: 0,
      unchanged: 0,
      unknownTag: 0,
      unknownGateway: 0,
      stale: 0,
    });
  });

  it("valid signature returns 202 (canonical two-`t` x-vettrack-* headers)", async () => {
    const body = Buffer.from(
      JSON.stringify({
        batchId: "b1",
        events: [{ tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date().toISOString() }],
      }),
    );
    const res = await postRfid(body, {
      "x-vettrack-clinic": CLINIC,
      "x-vettrack-signature": sign(body, SECRET),
      "content-type": "application/json",
    });

    expect(res.status).toBe(202);
    expect(res.json.ok).toBe(true);
    expect(mockIngest).toHaveBeenCalledOnce();
  });

  it("canonical brand-cased X-VetTrack-* (two-`t`) headers authenticate → 202", async () => {
    // The signer/brand emit `X-VetTrack-Clinic` / `X-VetTrack-Signature` (two `t`s;
    // Node lowercases them to `x-vettrack-*` on the wire). Before the header fix the
    // route read the one-`t` `x-vetrack-*` spelling, so a spec-following client hit
    // 400 MISSING_CLINIC. This locks the route onto the canonical two-`t` spelling.
    const body = Buffer.from(
      JSON.stringify({
        batchId: "b-canonical",
        events: [{ tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date().toISOString() }],
      }),
    );
    const res = await postRfid(body, {
      "X-VetTrack-Clinic": CLINIC,
      "X-VetTrack-Signature": sign(body, SECRET),
      "content-type": "application/json",
    });

    expect(res.status).toBe(202);
    expect(res.json.ok).toBe(true);
    expect(mockIngest).toHaveBeenCalledOnce();
  });

  it("the buggy one-`t` x-vetrack-clinic spelling is NOT accepted → 400", async () => {
    // Proves the route no longer silently authenticates the old one-`t` spelling:
    // a request carrying ONLY `x-vetrack-*` is treated as missing the clinic header.
    const body = Buffer.from(
      JSON.stringify({
        batchId: "b-legacy",
        events: [{ tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date().toISOString() }],
      }),
    );
    const res = await postRfid(body, {
      "x-vetrack-clinic": CLINIC,
      "x-vetrack-signature": sign(body, SECRET),
    });

    expect(res.status).toBe(400);
    expect(res.json.code).toBe("MISSING_CLINIC");
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("wrong secret returns 401", async () => {
    const body = Buffer.from(
      JSON.stringify({
        batchId: "b2",
        events: [{ tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date().toISOString() }],
      }),
    );
    const res = await postRfid(body, {
      "x-vettrack-clinic": CLINIC,
      "x-vettrack-signature": sign(body, "wrong-secret"),
    });

    expect(res.status).toBe(401);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("missing clinic header returns 400", async () => {
    const body = Buffer.from(
      JSON.stringify({
        batchId: "b3",
        events: [{ tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date().toISOString() }],
      }),
    );
    const res = await postRfid(body, {
      "x-vettrack-signature": sign(body, SECRET),
    });

    expect(res.status).toBe(400);
  });

  it("flag off returns 403", async () => {
    mockIsEnabled.mockResolvedValue(false);
    const body = Buffer.from(
      JSON.stringify({
        batchId: "b4",
        events: [{ tagEpc: "E280", gatewayCode: "GW-1", readAt: new Date().toISOString() }],
      }),
    );
    const res = await postRfid(body, {
      "x-vettrack-clinic": CLINIC,
      "x-vettrack-signature": sign(body, SECRET),
    });

    expect(res.status).toBe(403);
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("rejects body larger than 512kb", async () => {
    const huge = Buffer.alloc(512 * 1024 + 1, 0x61);
    const res = await postRfid(huge, {
      "x-vettrack-clinic": CLINIC,
      "x-vettrack-signature": sign(huge, SECRET),
    });

    expect(res.status).toBe(413);
  });
});
