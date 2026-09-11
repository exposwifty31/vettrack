// Express 5 (path-to-regexp v8) types `req.params.x` as `string | string[]`,
// because a wildcard or repeated segment can match more than one value. Every
// route in this server declares plain `:id`-style segments, so an array is
// unreachable today — but the type is honest about what the router CAN hand
// over, and a `.trim()` on an array is a crash in production. This accessor is
// the one place the narrowing happens: a non-empty string comes back, anything
// else is a typed 400 that terminalErrorHandler renders. Structurally typed so it
// compiles under @types/express 4 and 5 and accepts the plain-object mock
// requests the route tests already use.
export class RouteParamError extends Error {
  readonly status = 400;
  readonly code = "INVALID_ROUTE_PARAM";
  constructor(
    readonly param: string,
    readonly reason: "missing" | "empty" | "array",
  ) {
    super(
      reason === "array"
        ? `Route parameter "${param}" matched more than one segment`
        : reason === "empty"
          ? `Route parameter "${param}" is empty`
          : `Route parameter "${param}" is missing`,
    );
    this.name = "RouteParamError";
  }
}

type ParamsBag = { params: Record<string, string | string[] | undefined> };

/** Narrows `req.params[name]` to a non-empty string; throws RouteParamError otherwise. */
export function param(req: ParamsBag, name: string): string {
  const value = req.params[name];
  if (value === undefined || value === null) throw new RouteParamError(name, "missing");
  if (Array.isArray(value)) throw new RouteParamError(name, "array");
  if (value === "") throw new RouteParamError(name, "empty");
  return value;
}
