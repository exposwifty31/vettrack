import { addDays, format, parseISO } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { and, eq } from "drizzle-orm";
import { clinics, db } from "../db.js";

const DEFAULT_CLINIC_TIMEZONE = "Asia/Jerusalem";

const ISO_DAY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** UTC instants for [start, end) of a calendar day in the clinic IANA timezone. */
export function clinicDayUtcRange(dayIsoDate: string, timeZone: string): { dayStart: Date; dayEnd: Date } {
  if (!ISO_DAY_REGEX.test(dayIsoDate)) {
    throw new Error("day must be YYYY-MM-DD");
  }
  const tz = timeZone.trim() || DEFAULT_CLINIC_TIMEZONE;
  const dayStart = fromZonedTime(`${dayIsoDate}T00:00:00`, tz);
  const nextDayIso = format(addDays(parseISO(dayIsoDate), 1), "yyyy-MM-dd");
  const dayEnd = fromZonedTime(`${nextDayIso}T00:00:00`, tz);
  return { dayStart, dayEnd };
}

/** Today's calendar date (YYYY-MM-DD) in the clinic timezone. */
export function clinicTodayIsoDate(timeZone: string, now: Date = new Date()): string {
  const tz = timeZone.trim() || DEFAULT_CLINIC_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Failed to format clinic date for timezone ${tz}`);
  }
  return `${year}-${month}-${day}`;
}

export async function getClinicTimezone(clinicId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: clinics.timezone })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);
  return row?.timezone?.trim() || DEFAULT_CLINIC_TIMEZONE;
}

export async function getClinicDayUtcRange(
  clinicId: string,
  dayIsoDate: string,
): Promise<{ dayStart: Date; dayEnd: Date; timeZone: string }> {
  const timeZone = await getClinicTimezone(clinicId);
  const { dayStart, dayEnd } = clinicDayUtcRange(dayIsoDate, timeZone);
  return { dayStart, dayEnd, timeZone };
}
