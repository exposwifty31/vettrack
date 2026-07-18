import type { Request } from "express";

/**
 * Canonical parse of the `x-vettrack-clinic` request header for RFID doorway ingest.
 *
 * ONE source of truth for the string/array/trim ladder so the route handler
 * (MISSING_CLINIC gate) and the rate-limiter key (per-clinic bucket) can never
 * drift on header spelling — the exact drift behind the original one-`t` bug.
 * Node lowercases `X-VetTrack-Clinic` on the wire; this reads the two-`t` name.
 *
 * Returns the trimmed clinic id, or "" when the header is absent/empty (the
 * caller decides what an empty id means — a 400 in the route, a per-IP tail in
 * the limiter).
 */
export function readRfidClinicId(req: Request): string {
  const clinicHeader = req.headers["x-vettrack-clinic"];
  if (typeof clinicHeader === "string") return clinicHeader.trim();
  if (Array.isArray(clinicHeader)) return clinicHeader[0]?.trim() ?? "";
  return "";
}
