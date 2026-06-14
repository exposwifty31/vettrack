import { and, eq } from "drizzle-orm";
import { db, users } from "../db.js";
import type { Locale } from "../../lib/i18n/types.js";

export async function resolveUserLocale(clinicId: string, userId: string): Promise<Locale> {
  const [row] = await db
    .select({ preferredLocale: users.preferredLocale })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.clinicId, clinicId)))
    .limit(1);
  const loc = row?.preferredLocale;
  return loc === "en" || loc === "he" ? loc : "he";
}
