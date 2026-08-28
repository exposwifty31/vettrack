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
  // Express does not expose its router stack on any public type, and this test
  // is specifically about which middleware are MOUNTED — the one question the
  // public API cannot answer. Hence the cast; `RouteLayer` above is the shape
  // this file depends on, so a future Express change breaks compilation here
  // rather than silently matching nothing.
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
  // Safe: the assertion above throws unless exactly one layer matched, and a
  // matched layer has a `route` by construction of the filter.
  return found[0]!.route!.stack;
}

/**
 * Invoke one middleware in isolation with a non-UUID id and report the status
 * it responded with, or null if it deferred (called next) or blew up. Only a
 * synchronous response counts: `validateUuid` does no I/O, so anything async is
 * by definition a different middleware.
 */
/**
 * What one middleware did when handed a non-UUID id. Three outcomes, kept
 * DISTINCT on purpose: `probe` used to collapse all of them into `null`, so a
 * middleware that CRASHED was indistinguishable from one that correctly
 * deferred — and the suite then reported the route as accepting a slug id.
 */
type ProbeOutcome =
  | { kind: "responded"; status: number; body: unknown }
  | { kind: "deferred" }
  | { kind: "threw"; error: string };

function probe(handle: (...args: unknown[]) => unknown, method: string, path: string): ProbeOutcome {
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
    // next(err) is a REPORTED failure, not a deferral — a uuid guard that
    // delegates its 400 to Express error middleware must not read as passing.
    let nextErr: unknown = null;
    const result = handle(req, res, (err?: unknown) => {
      if (err != null) nextErr = err;
    });
    // An ASYNC rejection is expected noise: `validateUuid` does no I/O, so any
    // middleware that returns a promise is a DB-backed one being probed out of
    // context, and it has already been established that it is not the guard.
    // A SYNCHRONOUS throw is a different animal and is reported below.
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch(() => {});
    }
    if (nextErr != null) {
      return {
        kind: "threw",
        error: `next(err): ${nextErr instanceof Error ? nextErr.message : String(nextErr)}`,
      };
    }
  } catch (err) {
    return { kind: "threw", error: err instanceof Error ? err.message : String(err) };
  }
  return status === null ? { kind: "deferred" } : { kind: "responded", status, body };
}

describe("equipment routes — a non-UUID equipment id is not rejected as malformed", () => {
  it.each(GUARD_FREE_ROUTES)(
    "%s %s accepts a slug id without a 400 UUID rejection",
    (method, path) => {
      const stack = layersOf(method, path);
      // The terminal handler is never the uuid guard, and probing it would hit
      // the database out of context.
      const middleware = stack.slice(0, -1);

      const outcomes = middleware.map((layer, index) => ({
        index,
        outcome: probe(layer.handle, method, path),
      }));

      // A crash is not a pass. This assertion comes FIRST because a thrown
      // middleware produces no status, so the rejection filter below would
      // quietly count it as "did not reject".
      const crashed = outcomes
        .filter(({ outcome }) => outcome.kind === "threw")
        .map(({ index, outcome }) =>
          `position ${index}: ${(outcome as { kind: "threw"; error: string }).error}`,
        );
      expect(
        crashed,
        `${method.toUpperCase()} ${path} had middleware throw on the legal text id ` +
          `"${NON_UUID_ID}". That is a failure, not an acceptance — the old probe ` +
          `returned null for a crash and the suite read it as "no rejection".`,
      ).toEqual([]);

      const rejections = outcomes
        .filter(
          ({ outcome }) =>
            outcome.kind === "responded" &&
            outcome.status === 400 &&
            UUID_REJECTION.test(JSON.stringify(outcome.body ?? "")),
        )
        .map(
          ({ index, outcome }) =>
            `position ${index}: ${JSON.stringify((outcome as { body: unknown }).body)}`,
        );

      expect(
        rejections,
        `${method.toUpperCase()} ${path} rejected the legal text id "${NON_UUID_ID}" with 400. ` +
          `Equipment ids are TEXT primary keys; a bad id must fall through to the ` +
          `handler's 404, not be refused as malformed.`,
      ).toEqual([]);
    },
  );
});
