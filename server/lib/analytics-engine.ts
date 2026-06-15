import { formatInTimeZone } from "date-fns-tz";
import { subDays } from "date-fns";

/** Default clinic analytics TZ — aligns scan-day buckets with local hospital midnight. */
export const ANALYTICS_TIME_ZONE = "Asia/Jerusalem";

export interface ScanLogRow {
  timestamp: Date | string;
  status?: string;
  equipmentId?: string;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export function computeUsageTrends(
  scans: ScanLogRow[],
  timeZone: string = ANALYTICS_TIME_ZONE,
): TrendPoint[] {
  const now = new Date();
  const scanMap = new Map<string, number>();
  for (let i = 0; i < 30; i++) {
    const day = subDays(now, 29 - i);
    const date = formatInTimeZone(day, timeZone, "yyyy-MM-dd");
    scanMap.set(date, 0);
  }
  for (const scan of scans) {
    const date = formatInTimeZone(new Date(scan.timestamp), timeZone, "yyyy-MM-dd");
    if (scanMap.has(date)) {
      scanMap.set(date, scanMap.get(date)! + 1);
    }
  }
  return Array.from(scanMap.entries()).map(([date, count]) => ({ date, count }));
}
