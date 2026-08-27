/**
 * Equipment ids are TEXT primary keys (`server/schema/equipment.ts:112`), so
 * `pilot-glucometer-icu` and `eq1` are legal ids. `validateUuid("id")` rejected
 * them with 400 before the handler could look the row up and 404, which made
 * every slug-id equipment route unreachable.
 *
 * This locks the guard out of the twelve `:id` equipment routes so it cannot
 * creep back. It inspects the real mounted middleware chain of the real router
 * rather than the route file's source text, so a rename, a reformat, or a
 * re-import under another name cannot fool it: each middleware is probed with a
 * non-UUID `params.id` and identified by its behaviour.
 *
 * Deliberately NOT asserted here: the sibling routes that never had the guard
 * (`get /:id`, `get /:id/truth`, `get /:id/logs`, `get /:id/transfers`).
 */
import { describe, expect, it } from "vitest";
import router from "../server/routes/equipment.js";

const NON_UUID_ID = "pilot-glucometer-icu";
const UUID_REJECTION = /must be a valid UUID/i;

/** The twelve `:id` equipment routes that must accept a slug id. */
const GUARD_FREE_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["patch", "/:id"],
  ["delete", "/:id"],
  ["post", "/:id/restore"],
  ["post", "/:id/toggle"],
  ["post", "/:id/checkout"],
  ["post", "/:id/return"],
  ["post", "/:id/seen"],
  ["post", "/:id/scan"],
  ["post", "/:id/revert"],
  ["get", "/:id/waitlist"],
  ["post", "/:id/waitlist"],
  ["delete", "/:id/waitlist"],
];

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (...args: unknown[]) => unknown }>;
  };
}

function layersOf(method: string, path: string) {
  const stack = (router as unknown as { stack: RouteLayer[] }).stack;
  const found = stack.filter(
    (l) => l.route?.path === path && l.route.methods[method] === true,
  );
  // Fail loud rather than silently passing if a route is renamed or removed.
  expect(
    found.length,
    `route ${method.toUpperCase()} ${path} is not mounted on the equipment router — ` +
      `update this test deliberately, do not let it pass by absence`,
  ).toBe(1);
  return found[0]!.route!.stack;
}

/**
 * Invoke one middleware in isolation with a non-UUID id and report the status
 * it responded with, or null if it deferred (called next) or blew up. Only a
 * synchronous response counts: `validateUuid` does no I/O, so anything async is
 * by definition a different middleware.
 */
function probe(handle: (...args: unknown[]) => unknown, method: string, path: string) {
  let status: number | null = null;
  let body: unknown = null;
  const res = {
    headersSent: false,
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      this.headersSent = true;
      return this;
    },
    send(payload: unknown) {
      body = payload;
      this.headersSent = true;
      return this;
    },
    end() {
      this.headersSent = true;
      return this;
    },
    setHeader() {
      return this;
    },
    getHeader() {
      return undefined;
    },
    set() {
      return this;
    },
    sendStatus(code: number) {
      status = code;
      this.headersSent = true;
      return this;
    },
  };
  const req = {
    params: { id: NON_UUID_ID },
    body: {},
    query: {},
    headers: {},
    method: method.toUpperCase(),
    originalUrl: path.replace(":id", NON_UUID_ID),
    url: path.replace(":id", NON_UUID_ID),
    ip: "127.0.0.1",
    get: () => undefined,
  };

  try {
    const result = handle(req, res, () => {});
    // Swallow async rejections from DB-backed middleware probed out of context.
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    return null;
  }
  return status === null ? null : { status, body };
}

describe("equipment routes — a non-UUID equipment id is not rejected as malformed", () => {
  it.each(GUARD_FREE_ROUTES)(
    "%s %s accepts a slug id without a 400 UUID rejection",
    (method, path) => {
      const stack = layersOf(method, path);
      // The terminal handler is never the uuid guard, and probing it would hit
      // the database out of context.
      const middleware = stack.slice(0, -1);

      const rejections = middleware
        .map((layer, index) => ({ index, result: probe(layer.handle, method, path) }))
        .filter(
          ({ result }) =>
            result?.status === 400 &&
            UUID_REJECTION.test(JSON.stringify(result.body ?? "")),
        )
        .map(({ index, result }) => `position ${index}: ${JSON.stringify(result!.body)}`);

      expect(
        rejections,
        `${method.toUpperCase()} ${path} rejected the legal text id "${NON_UUID_ID}" with 400. ` +
          `Equipment ids are TEXT primary keys; a bad id must fall through to the ` +
          `handler's 404, not be refused as malformed.`,
      ).toEqual([]);
    },
  );
});
