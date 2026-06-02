import type { AuthUser } from "../middleware/auth.js";

/** ER module removed — no clinic user may toggle ER mode. */
export function canManageErModeForUser(_user: AuthUser): boolean {
  return false;
}
