import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";

/**
 * R-CBF-1.3 — throttled/batched screen-reader announcer for the emergency timed
 * log. A live Code Blue can log entries in rapid bursts (equipment presets,
 * dispenses, notes); announcing one `aria-live` message per entry would flood a
 * screen-reader user mid-emergency. This coalesces a burst into a SINGLE polite
 * announcement per throttle window ("N new log entries") — never one-per-entry.
 */
export interface LiveLogEntry {
  id: string;
  label: string;
}

export interface LiveLogAnnouncerProps {
  entries: LiveLogEntry[];
  /** Coalescing window; a burst inside one window yields one announcement. */
  throttleMs?: number;
}

const DEFAULT_THROTTLE_MS = 1500;

export function LiveLogAnnouncer({ entries, throttleMs = DEFAULT_THROTTLE_MS }: LiveLogAnnouncerProps) {
  const [message, setMessage] = useState("");
  // Seed the baseline to the mount-time entry count so re-entering an ALREADY-active
  // Code Blue (timeline already holds N rows) does NOT announce the whole history as
  // "N new log entries" — only entries that arrive after mount are announced.
  const announcedCountRef = useRef(entries.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<LiveLogEntry[]>(entries);
  latestRef.current = entries;

  useEffect(() => {
    const count = entries.length;
    // On shrink/reset keep the baseline in sync so a later re-grow announces only
    // the genuinely new entries.
    if (count <= announcedCountRef.current) {
      announcedCountRef.current = count;
      return;
    }
    // A batch window is already pending — fold this entry into it rather than
    // scheduling a second announcement.
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const total = latestRef.current.length;
      const delta = total - announcedCountRef.current;
      announcedCountRef.current = total;
      if (delta <= 0) return;
      // Clear then re-set on a later tick so two consecutive windows with an
      // IDENTICAL delta ("2 new log entries" twice) still register as a DOM change
      // — an unchanged aria-live text is dropped by screen readers.
      setMessage("");
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        setMessage(t.codeBlue.hold.newLogEntries(delta));
      }, 0);
    }, throttleMs);
  }, [entries, throttleMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  return (
    <div
      data-testid="cb-live-log-announcer"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}
