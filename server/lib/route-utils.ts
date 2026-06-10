import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { apiError as i18nApiError } from "./apiError.js";

export function resolveRequestId(
  res: { getHeader: (name: string) => unknown; setHeader?: (name: string, value: string) => void },
  incomingHeader: unknown,
): string {
  const incoming = typeof incomingHeader === "string" ? incomingHeader.trim() : "";
  const existing = res.getHeader("x-request-id");
  const fromRes = typeof existing === "string" ? existing.trim() : "";
  const requestId = incoming || fromRes || randomUUID();
  if (typeof res.setHeader === "function") {
    res.setHeader("x-request-id", requestId);
  }
  return requestId;
}

export function requireNotProduction(i18nKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.NODE_ENV === "production") {
      i18nApiError(req, res, i18nKey as Parameters<typeof i18nApiError>[2], undefined, 403);
      return;
    }
    next();
  };
}

export function apiError(params: { code: string; reason: string; message: string; requestId: string; details?: unknown }) {
  return {
    code: params.code,
    error: params.code,
    reason: params.reason,
    message: params.message,
    requestId: params.requestId,
    ...(params.details !== undefined ? { details: params.details } : {}),
  };
}
