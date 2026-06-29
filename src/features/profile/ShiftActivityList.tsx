import { useQuery } from "@tanstack/react-query";
import { api, type ShiftActivityItem } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const mins = Math.round((end - start) / 60000);
  if (mins < 60) return t.profile.durationMins.replace("{minutes}", String(mins));
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return t.profile.duration.replace("{hours}", String(hours)).replace("{minutes}", String(rem));
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ShiftActivityList() {
  const { userId } = useAuth();

  const { data: sessions, isLoading, isError, refetch } = useQuery<ShiftActivityItem[]>({
    queryKey: ["/api/users/me/shift-activity", userId],
    queryFn: api.users.shiftActivity,
    enabled: !!userId,
    staleTime: 60_000,
  });

  return (
    <div>
      <div style={{ paddingInline: 20, paddingTop: 8, paddingBottom: 4 }}>
        <p style={{
          fontSize: "var(--text-2xs, 11px)",
          fontWeight: 600,
          color: "hsl(var(--muted-foreground))",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: 0,
        }}>
          {t.profile.shiftActivity}
        </p>
      </div>

      {isLoading && (
        <div style={{ paddingInline: 20, paddingBlock: 16 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 52,
              borderRadius: 10,
              background: "hsl(var(--muted))",
              marginBottom: 8,
              opacity: 0.6,
            }} />
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div style={{ paddingInline: 20, paddingBlock: 24, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "hsl(var(--destructive))", margin: 0 }}>
            {t.profile.shiftActivityError}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            style={{
              marginTop: 8,
              fontSize: 13,
              color: "hsl(var(--primary))",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {t.common.tryAgain}
          </button>
        </div>
      )}

      {!isLoading && !isError && (!sessions || sessions.length === 0) && (
        <div style={{ paddingInline: 20, paddingBlock: 24, textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", margin: 0 }}>
            {t.profile.noShiftActivity}
          </p>
        </div>
      )}

      {!isLoading && !isError && sessions && sessions.length > 0 && (
        <div style={{ paddingInline: 16, paddingBottom: 24 }}>
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: ShiftActivityItem }) {
  const isActive = !session.endedAt;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      paddingBlock: 12,
      paddingInline: 4,
      borderBottom: "0.5px solid hsl(var(--border))",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: "hsl(var(--foreground))" }}>
          {formatDate(session.startedAt)}
        </span>
        <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
          {formatTime(session.startedAt)}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
        {isActive ? (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: "hsl(var(--primary))",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}>
            {t.profile.activeSession}
          </span>
        ) : (
          <span style={{
            fontSize: 14,
            fontWeight: 500,
            fontVariantNumeric: "tabular-nums",
            color: "hsl(var(--foreground))",
          }}>
            {formatDuration(session.startedAt, session.endedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
