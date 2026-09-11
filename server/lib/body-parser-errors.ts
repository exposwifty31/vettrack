import type express from "express";
import { RouteParamError } from "./route-params.js";

// Aligned with the 5 MB multer file-upload limits (server/routes/uploads.ts,
// server/routes/shifts.ts) so JSON-posted CSV payloads don't hit a lower
// ceiling than the equivalent file upload.
export const JSON_BODY_LIMIT = "5mb";

export type ClassifiedBodyParserError = {
  status: number;
  code: string;
  message: string;
};

export function classifyBodyParserError(err: unknown): ClassifiedBodyParserError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { type?: unknown; status?: unknown; statusCode?: unknown };
  const status =
    typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : null;

  if (e.type === "entity.too.large") {
    return {
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: `Request body exceeds the ${JSON_BODY_LIMIT} limit`,
    };
  }
  if (e.type === "entity.parse.failed" || (err instanceof SyntaxError && status === 400)) {
    return { status: 400, code: "INVALID_JSON", message: "Request body is not valid JSON" };
  }
  if (typeof e.type === "string" && status !== null && status >= 400 && status < 500) {
    return { status, code: "REQUEST_BODY_REJECTED", message: "Request body was rejected" };
  }
  return null;
}

export function terminalErrorHandler(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
): void {
  // A route param that failed narrowing (see route-params.ts) is a client error
  // with a stable code, not an unhandled exception: no console.error, 400.
  if (err instanceof RouteParamError) {
    if (!res.headersSent) {
      res.status(err.status).json({ error: err.message, code: err.code, param: err.param });
    }
    return;
  }
  const classified = classifyBodyParserError(err);
  if (classified) {
    if (!res.headersSent) {
      res.status(classified.status).json({ error: classified.message, code: classified.code });
    }
    return;
  }
  console.error("Unhandled application error", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal Server Error" });
}
