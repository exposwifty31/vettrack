/**
 * Code Blue clinic-wide activation push — i18n extraction.
 *
 * Copy lives under `push.codeBlue.*` and is rendered via
 * `resolveCodeBlueBroadcastPushCopy` (Hebrew product default). These tests
 * execute both initiation handlers with mocked deps and assert the real
 * `enqueueNotificationJob` payload — source-text greps alone are not enough.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { Request, Response } from "express";
import enDict from "../locales/en.json";
import heDict from "../locales/he.json";

/** Literal Hebrew block (U+0590–U+05FF). */
const HEBREW_LITERAL_RE = /[֐-׿]/;
/**
 * Escaped Hebrew in source: `\u05xx` / `\u0590`–`\u05FF` and `\u{5xx}` forms.
 * Locale JSON may contain literal glyphs; production `.ts` must not sneak Hebrew
 * back in via Unicode escapes.
 */
const HEBREW_ESCAPE_RE =
  /\\u05[0-9A-Fa-f]{2}|\\u\{0*5[0-9A-Fa-f]{2,}\}/;

function containsHebrewInSource(src: string): boolean {
  return HEBREW_LITERAL_RE.test(src) || HEBREW_ESCAPE_RE.test(src);
}

const HANDLERS = [
  "server/routes/code-blue/handlers/post-sessions.ts",
  "server/routes/code-blue/handlers/post-one-tap.ts",
] as const;

const HELPER = "server/lib/code-blue-broadcast-push.ts";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8");
}

const ACTOR_NAME = "Dr Cohen";
const CLINIC_ID = "clinic-cb-1";
const MANAGER_ID = "mgr-1";
const ONE_TAP_SESSION_ID = "session-ot-1";

const {
  enqueueNotificationJob,
  evaluateCodeBlueManagerForRoute,
  insertRealtimeDomainEvent,
  orchestrateOneTapCodeBlue,
  postSystemMessage,
  logAudit,
  invalidateActiveCodeBlueCache,
  dbState,
} = vi.hoisted(() => {
  const enqueueNotificationJob = vi.fn(async () => undefined);
  const evaluateCodeBlueManagerForRoute = vi.fn(async () => ({
    verdict: { action: "allow" as const },
  }));
  const insertRealtimeDomainEvent = vi.fn(async () => 99);
  const orchestrateOneTapCodeBlue = vi.fn(async () => ({
    kind: "created" as const,
    sessionId: "session-ot-1",
    reservedCartId: null,
    pagingState: "queued" as const,
    pagingOutboxId: 42,
  }));
  const postSystemMessage = vi.fn(async () => undefined);
  const logAudit = vi.fn();
  const invalidateActiveCodeBlueCache = vi.fn();
  const dbState = {
    managerRows: [{ id: "mgr-1", name: "Manager Vet" }] as Array<{
      id: string;
      name: string;
    }>,
    activeSessionRows: [] as Array<{ id: string }>,
  };
  return {
    enqueueNotificationJob,
    evaluateCodeBlueManagerForRoute,
    insertRealtimeDomainEvent,
    orchestrateOneTapCodeBlue,
    postSystemMessage,
    logAudit,
    invalidateActiveCodeBlueCache,
    dbState,
  };
});

function selectLimitChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

vi.mock("../server/db.js", () => {
  const tx = {
    execute: async () => undefined,
    select: () => selectLimitChain(dbState.activeSessionRows),
    insert: () => ({
      values: async () => undefined,
    }),
  };
  return {
    db: {
      select: () => selectLimitChain(dbState.managerRows),
      transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
    codeBlueSessions: {
      id: "codeBlueSessions.id",
      clinicId: "codeBlueSessions.clinicId",
      status: "codeBlueSessions.status",
    },
    codeBlueLogEntries: {},
    users: {
      id: "users.id",
      name: "users.name",
      clinicId: "users.clinicId",
      role: "users.role",
      status: "users.status",
    },
    equipment: {
      id: "equipment.id",
      name: "equipment.name",
      clinicId: "equipment.clinicId",
      deletedAt: "equipment.deletedAt",
    },
  };
});

vi.mock("../server/lib/queue.js", () => ({
  enqueueNotificationJob: (...args: unknown[]) => enqueueNotificationJob(...args),
}));

vi.mock("../server/lib/authority/code-blue-manager.wiring.js", () => ({
  evaluateCodeBlueManagerForRoute: (...args: unknown[]) =>
    evaluateCodeBlueManagerForRoute(...args),
}));

vi.mock("../server/lib/realtime-outbox.js", () => ({
  insertRealtimeDomainEvent: (...args: unknown[]) => insertRealtimeDomainEvent(...args),
}));

vi.mock("../server/lib/audit.js", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
  resolveAuditActorRole: () => "vet",
}));

vi.mock("../server/lib/shift-chat-presence.js", () => ({
  postSystemMessage: (...args: unknown[]) => postSystemMessage(...args),
}));

vi.mock("../server/lib/code-blue-keepalive.js", () => ({
  invalidateActiveCodeBlueCache: (...args: unknown[]) =>
    invalidateActiveCodeBlueCache(...args),
}));

vi.mock("../server/lib/code-blue-one-tap.js", () => ({
  orchestrateOneTapCodeBlue: (...args: unknown[]) => orchestrateOneTapCodeBlue(...args),
  DrizzleOneTapSessionTransaction: class {},
  DrizzlePagingStateStore: class {},
}));

vi.mock("../server/lib/code-blue-start-claim.js", () => ({
  DrizzleStartClaimStore: class {},
}));

vi.mock("../server/lib/code-blue-nearest-cart.js", () => ({
  resolveNearestReadyCart: vi.fn(async () => null),
  DrizzleInitiatingLocationSource: class {},
  DrizzleReadyCartCandidateSource: class {},
}));

type Captured = { statusCode: number; body: Record<string, unknown>; responded: boolean };

/**
 * Runtime narrowing for values captured out of a handler. A blind `as` on a
 * captured value moves the failure downstream: a missing `id` becomes
 * `undefined.length` three assertions later. These check at the boundary and
 * name the field, and they narrow via `typeof` / a type predicate — no cast.
 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: expected a non-empty string, received ${JSON.stringify(value)}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label}: expected an object, received ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * `push.codeBlue.{title,body}` out of an imported locale JSON, narrowed one key
 * at a time. The alternative is casting the whole dictionary to an asserted
 * shape, which turns a missing key into `expect(undefined).toBe(...)` — a
 * failure that names the expected string but not the key that went missing.
 */
function localePushCopy(dict: unknown, label: string): { title: string; body: string } {
  const push = requireRecord(requireRecord(dict, label).push, `${label} push`);
  const codeBlue = requireRecord(push.codeBlue, `${label} push.codeBlue`);
  return {
    title: requireString(codeBlue.title, `${label} push.codeBlue.title`),
    body: requireString(codeBlue.body, `${label} push.codeBlue.body`),
  };
}

function makeRes(): { res: Response; captured: Captured } {
  const captured: Captured = { statusCode: 200, body: {}, responded: false };
  const headers = new Map<string, string>();
  const res = {
    locals: {},
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.body = payload;
      captured.responded = true;
      return this;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    // EXPRESS BOUNDARY CAST, and the one place a cast is unavoidable. `Response`
    // extends Node's `ServerResponse` and adds ~60 members (`app`, `req`,
    // `sendFile`, `cookie`, `render`, `redirect`…). These handlers touch only
    // status/json/setHeader/getHeader/locals, so a structurally complete fixture
    // would be unbuildable noise that tests nothing. Anything the handler reaches
    // for and this object does not define is `undefined`, so an unexpected call
    // fails loudly here rather than silently reading a stub.
  } as unknown as Response;
  return { res, captured };
}

function makeReq(body: Record<string, unknown>): Request {
  return {
    method: "POST",
    headers: { "x-request-id": "test-req-cb-push" },
    params: {},
    query: {},
    body,
    clinicId: CLINIC_ID,
    authUser: {
      id: "actor-1",
      name: ACTOR_NAME,
      email: "actor@clinic.test",
      role: "vet",
      clinicId: CLINIC_ID,
    },
    // EXPRESS BOUNDARY CAST — same reasoning as `makeRes`. `Request` extends
    // Node's `IncomingMessage` and adds the routing/content-negotiation surface
    // (`app`, `route`, `accepts`, `is`, `cookies`, `signedCookies`, `socket`…),
    // plus this repo's `clinicId` / `authUser` augmentation. The handler reads
    // only headers/params/query/body/clinicId/authUser.
  } as unknown as Request;
}

const { postSessionsHandler } = await import(
  "../server/routes/code-blue/handlers/post-sessions.js"
);
const { postOneTapHandler } = await import(
  "../server/routes/code-blue/handlers/post-one-tap.js"
);
const { resolveCodeBlueBroadcastPushCopy, __setCodeBlueBroadcastPushI18nForTests } =
  await import("../server/lib/code-blue-broadcast-push.js");

beforeEach(() => {
  enqueueNotificationJob.mockReset();
  enqueueNotificationJob.mockResolvedValue(undefined);
  evaluateCodeBlueManagerForRoute.mockReset();
  evaluateCodeBlueManagerForRoute.mockResolvedValue({
    verdict: { action: "allow" },
  });
  insertRealtimeDomainEvent.mockReset();
  insertRealtimeDomainEvent.mockResolvedValue(99);
  orchestrateOneTapCodeBlue.mockReset();
  orchestrateOneTapCodeBlue.mockResolvedValue({
    kind: "created",
    sessionId: ONE_TAP_SESSION_ID,
    reservedCartId: null,
    pagingState: "queued",
    pagingOutboxId: 42,
  });
  postSystemMessage.mockReset();
  postSystemMessage.mockResolvedValue(undefined);
  logAudit.mockReset();
  invalidateActiveCodeBlueCache.mockReset();
  dbState.managerRows = [{ id: MANAGER_ID, name: "Manager Vet" }];
  dbState.activeSessionRows = [];
  __setCodeBlueBroadcastPushI18nForTests(null);
});

describe("push.codeBlue locale keys (parity + clinical wording)", () => {
  it("Hebrew title and body match today's clinic-known wording", () => {
    const copy = localePushCopy(heDict, "locales/he.json");
    expect(copy.title).toBe("⚠ CODE BLUE");
    expect(copy.body).toBe("CODE BLUE הופעל ע״י {name}");
  });

  it("English body keeps CODE BLUE clinical term and interpolates {name}", () => {
    const copy = localePushCopy(enDict, "locales/en.json");
    expect(copy.title).toBe("⚠ CODE BLUE");
    expect(copy.body).toBe("CODE BLUE activated by {name}");
  });
});

describe("resolveCodeBlueBroadcastPushCopy", () => {
  it("renders Hebrew default body with the actor name interpolated", () => {
    const copy = resolveCodeBlueBroadcastPushCopy('ד"ר כהן');
    expect(copy.title).toBe("⚠ CODE BLUE");
    expect(copy.body).toBe('CODE BLUE הופעל ע״י ד"ר כהן');
  });

  it("fail-opens with ASCII fallback when i18n throws (never skips the push)", () => {
    __setCodeBlueBroadcastPushI18nForTests(() => {
      throw new Error("locale load failed");
    });
    try {
      const copy = resolveCodeBlueBroadcastPushCopy("Alex");
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.body).toContain("Alex");
      expect(HEBREW_LITERAL_RE.test(copy.title + copy.body)).toBe(false);
    } finally {
      __setCodeBlueBroadcastPushI18nForTests(null);
    }
  });

  it("helper uses INITIAL_LOCALE (he) and push.codeBlue.* keys via translate", () => {
    const src = read(HELPER);
    expect(src).toMatch(/getLocaleDictionaries/);
    expect(src).toMatch(/translate/);
    expect(src).toMatch(/INITIAL_LOCALE/);
    expect(src).toMatch(/push\.codeBlue\.title/);
    expect(src).toMatch(/push\.codeBlue\.body/);
    expect(src).toMatch(/try\s*\{/);
    expect(src).toMatch(/catch/);
    expect(containsHebrewInSource(src)).toBe(false);
  });
});

describe("Hebrew source scan (literal + Unicode escapes)", () => {
  it("detects both literal glyphs and \\u05xx / \\u{5xx} escapes", () => {
    expect(containsHebrewInSource("plain ASCII")).toBe(false);
    expect(containsHebrewInSource("הופעל")).toBe(true);
    expect(containsHebrewInSource('"\\u05D0"')).toBe(true);
    expect(containsHebrewInSource('"\\u05d0code"')).toBe(true);
    expect(containsHebrewInSource('"\\u{5D0}"')).toBe(true);
    expect(containsHebrewInSource('"\\u{0590}"')).toBe(true);
    expect(containsHebrewInSource('"\\u0041"')).toBe(false);
  });

  for (const rel of HANDLERS) {
    it(`${rel} contains neither literal Hebrew nor Hebrew Unicode escapes`, () => {
      expect(containsHebrewInSource(read(rel))).toBe(false);
    });
  }
});

describe("postSessionsHandler → enqueueNotificationJob integration", () => {
  it("enqueues code_blue_broadcast with localized title/body and code-blue-${id} tag", async () => {
    const expected = resolveCodeBlueBroadcastPushCopy(ACTOR_NAME);
    const { res, captured } = makeRes();

    await postSessionsHandler(
      makeReq({ managerUserId: MANAGER_ID, preCheckPassed: true }),
      res,
      () => undefined,
    );

    expect(captured.responded).toBe(true);
    expect(captured.statusCode).toBe(201);
    // `requireString` enforces both conditions the two removed `expect`s asserted
    // (string, non-empty) — earlier, and naming the field when it fails.
    const sessionId = requireString(captured.body.id, "captured.body.id");

    expect(enqueueNotificationJob).toHaveBeenCalledTimes(1);
    const job = requireRecord(
      enqueueNotificationJob.mock.calls[0]?.[0],
      "enqueueNotificationJob job payload",
    );
    expect(job).toMatchObject({
      type: "code_blue_broadcast",
      clinicId: CLINIC_ID,
      title: expected.title,
      body: expected.body,
      tag: `code-blue-${sessionId}`,
      notificationRequestOutboxId: 99,
    });
    expect(job.title).toBe("⚠ CODE BLUE");
    expect(job.body).toBe(`CODE BLUE הופעל ע״י ${ACTOR_NAME}`);
    expect(job.title).not.toMatch(/hardcoded/i);
  });

  it("still returns 201 when enqueueNotificationJob rejects (.catch fail-open)", async () => {
    enqueueNotificationJob.mockRejectedValueOnce(new Error("queue down"));
    const { res, captured } = makeRes();

    await postSessionsHandler(
      makeReq({ managerUserId: MANAGER_ID }),
      res,
      () => undefined,
    );

    expect(captured.statusCode).toBe(201);
    expect(enqueueNotificationJob).toHaveBeenCalledTimes(1);
    // Flush the voided rejection so it does not become an unhandledRejection.
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe("postOneTapHandler → enqueueNotificationJob integration", () => {
  it("enqueues code_blue_broadcast with localized title/body and code-blue-${sessionId} tag", async () => {
    const expected = resolveCodeBlueBroadcastPushCopy(ACTOR_NAME);
    const { res, captured } = makeRes();

    await postOneTapHandler(
      makeReq({
        managerUserId: MANAGER_ID,
        idempotencyToken: "tok-1",
        preCheckPassed: true,
      }),
      res,
      () => undefined,
    );

    expect(captured.responded).toBe(true);
    expect(captured.statusCode).toBe(201);
    expect(captured.body.sessionId).toBe(ONE_TAP_SESSION_ID);

    expect(enqueueNotificationJob).toHaveBeenCalledTimes(1);
    const job = requireRecord(
      enqueueNotificationJob.mock.calls[0]?.[0],
      "enqueueNotificationJob job payload",
    );
    expect(job).toMatchObject({
      type: "code_blue_broadcast",
      clinicId: CLINIC_ID,
      title: expected.title,
      body: expected.body,
      tag: `code-blue-${ONE_TAP_SESSION_ID}`,
      notificationRequestOutboxId: 42,
    });
    expect(job.title).toBe("⚠ CODE BLUE");
    expect(job.body).toBe(`CODE BLUE הופעל ע״י ${ACTOR_NAME}`);
  });

  it("still returns 201 when enqueueNotificationJob rejects (.catch fail-open)", async () => {
    enqueueNotificationJob.mockRejectedValueOnce(new Error("queue down"));
    const { res, captured } = makeRes();

    await postOneTapHandler(
      makeReq({ managerUserId: MANAGER_ID, idempotencyToken: "tok-2" }),
      res,
      () => undefined,
    );

    expect(captured.statusCode).toBe(201);
    expect(enqueueNotificationJob).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("does not enqueue on idempotent replay (side-effect-free)", async () => {
    orchestrateOneTapCodeBlue.mockResolvedValueOnce({
      kind: "replay",
      sessionId: ONE_TAP_SESSION_ID,
      pagingState: "queued",
    });
    const { res, captured } = makeRes();

    await postOneTapHandler(
      makeReq({ managerUserId: MANAGER_ID, idempotencyToken: "tok-replay" }),
      res,
      () => undefined,
    );

    expect(captured.statusCode).toBe(200);
    expect(enqueueNotificationJob).not.toHaveBeenCalled();
  });
});

describe("KNOWN_DEBT_ALLOWLIST no longer lists the extracted handlers", () => {
  it("drops post-sessions.ts and post-one-tap.ts from the Hebrew-in-source allowlist", () => {
    const allowlistSrc = read("tests/i18n-no-hebrew-in-source.test.ts");
    expect(allowlistSrc).not.toContain(
      '"server/routes/code-blue/handlers/post-one-tap.ts"',
    );
    expect(allowlistSrc).not.toContain(
      '"server/routes/code-blue/handlers/post-sessions.ts"',
    );
  });
});
