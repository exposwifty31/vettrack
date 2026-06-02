import type { Express, RequestHandler } from "express";
import express from "express";

export type RfidRouterFactory = () => RequestHandler;

/**
 * Mount RFID ingest with raw JSON body (HMAC-safe). Each mount gets its own parser stack.
 */
export function mountRfidRoutes(
  app: Express,
  path: string,
  createRouter: RfidRouterFactory,
): void {
  app.use(path, express.raw({ type: () => true, limit: "512kb" }), createRouter());
}
