/**
 * R-RTC-1.1 — bridge a handshake bearer token to the app's existing session→DB
 * identity path (`resolveAuthUser`). Identity (role, clinicId, userId) is ALWAYS
 * read from the DB session; nothing here trusts a client claim.
 */
import type { Request } from "express";
import { resolveAuthUser } from "../../middleware/auth.js";
import type { CollabIdentity } from "./rooms.js";
import type { ResolveHandshakeIdentity } from "./handshake.js";

/**
 * Build the minimal `Request`-like shape `resolveAuthUser` reads: the bearer token
 * as an `Authorization` header, plus the dev-bypass override headers (honored only
 * when the server is actually in dev-bypass mode). Clerk mode validates the bearer
 * token through the same readClerkUserSession path the REST middleware uses.
 */
export const resolveHandshakeIdentity: ResolveHandshakeIdentity = async (token, devHeaders) => {
  const headers: Record<string, string | undefined> = {
    authorization: `Bearer ${token}`,
    "x-dev-role-override": devHeaders["x-dev-role-override"],
    "x-dev-user-id-override": devHeaders["x-dev-user-id-override"],
    "x-dev-clinic-id-override": devHeaders["x-dev-clinic-id-override"],
  };
  const pseudo = { headers, socket: {}, ip: "" } as unknown as Request;
  const result = await resolveAuthUser(pseudo);
  if (!result.ok) return null;
  const user = result.user;
  if (!user.clinicId) return null;
  const identity: CollabIdentity = {
    userId: user.id,
    clinicId: user.clinicId,
    role: String(user.role),
    displayName: user.name ?? "Unknown",
  };
  return identity;
};
