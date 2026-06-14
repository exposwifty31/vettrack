// src/pages/code-blue-display.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, Wifi, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import { clearCodeBlueSessionCache } from "@/hooks/useCodeBlueSession";
import { useAuth } from "@/hooks/use-auth";
import type { SessionPollResult } from "@/hooks/useCodeBlueSession";
import { t } from "@/lib/i18n";

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function useElapsed(startedAt: string | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setElapsed(Date.now() - new Date(startedAt).getTime());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

export default function CodeBlueDisplay() {
  const { userId } = useAuth();

  const pollQ = useQuery<SessionPollResult>({
    queryKey: ["/api/code-blue/sessions/active"],
    queryFn: async () => {
      const data = await api.codeBlue.sessions.getActive();
      if (!data.session || data.session.status !== "active") {
        clearCodeBlueSessionCache();
      }
      return data;
    },
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: !!userId,
  });

  const session = pollQ.data?.session ?? null;
  const logEntries = pollQ.data?.logEntries ?? [];
  const presence = pollQ.data?.presence ?? [];
  const linkedEquipment = pollQ.data?.linkedEquipment ?? [];

  const startedAtRef = useRef<string | null>(null);
  if (session?.startedAt) {
    startedAtRef.current = session.startedAt;
  } else {
    startedAtRef.current = null;
  }
  const elapsed = useElapsed(startedAtRef.current);
  const recentEntries = useMemo(
    () => [...logEntries].reverse().slice(0, 8),
    [logEntries]
  );

  const equipmentCount = linkedEquipment.length;

  return (
    <div
      className="relative min-h-screen bg-zinc-950 text-white flex flex-col"
      dir="rtl"
      style={{ borderTop: session ? "4px solid var(--destructive)" : "4px solid var(--border)" }}
    >
      {/* Connection indicator */}
      <div className="absolute top-2 start-2">
        {pollQ.isError
          ? <WifiOff className="h-4 w-4 text-red-400" />
          : <Wifi className="h-4 w-4 text-green-500/50" />
        }
      </div>
      {pollQ.isError && (
        <div className="text-center text-red-400 text-sm py-1 bg-red-950/30">
          {t.codeBlue.display.connectionLost}
        </div>
      )}

      {!session ? (
        /* Standby */
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-zinc-600">
            <div className="text-4xl font-black tracking-widest mb-4">{t.codeBlue.display.awaitingEvent}</div>
            <div className="text-lg">{t.codeBlue.display.autoUpdateNote}</div>
          </div>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="px-8 py-4 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <div className="text-red-400 font-black tracking-widest text-2xl">⚠ CODE BLUE ACTIVE</div>
              {linkedEquipment.length > 0 && (
                <div className="text-amber-300/90 text-base mt-1">
                  {t.codeBlue.display.equipmentInEvent}: {linkedEquipment.map((e) => e.name).join(" · ")}
                </div>
              )}
            </div>
            <div className="text-end text-sm text-zinc-400 flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-400" />
              {session.managerUserName}
            </div>
          </div>

          {/* Giant timer */}
          <div className="px-8 py-10 bg-zinc-900/60 border-b border-zinc-800 text-center">
            <div className="font-black text-9xl tracking-widest font-mono leading-none">
              {formatElapsed(elapsed)}
            </div>
            <div className="flex gap-6 justify-center items-center mt-4 text-zinc-400 text-base">
              <span>{t.codeBlue.display.elapsedLabel}</span>
              {equipmentCount > 0 && (
                <span className="text-amber-300/90 font-semibold">
                  {t.codeBlue.display.equipmentCountLine(equipmentCount)}
                </span>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="flex-1 px-8 py-6 overflow-y-auto">
            <div className="text-sm text-zinc-500 tracking-widest uppercase mb-4">{t.codeBlue.display.events}</div>
            <div className="flex flex-col gap-4">
              {recentEntries.map((entry) => (
                <div key={entry.id} className="flex gap-6 items-baseline">
                  <span className="text-2xl font-mono text-zinc-600 min-w-[60px]">{formatElapsed(entry.elapsedMs)}</span>
                  <span className="text-2xl text-white">{entry.label}</span>
                  <span className="text-base text-green-400 mr-auto">{entry.loggedByName}</span>
                </div>
              ))}
              {logEntries.length === 0 && (
                <p className="text-zinc-600 text-xl">{t.codeBlue.display.noEvents}</p>
              )}
            </div>
          </div>

          {/* Presence */}
          <div className="px-8 py-4 border-t border-zinc-800 flex gap-3 items-center">
            <span className="text-sm text-zinc-600">{t.codeBlue.display.present}</span>
            {presence.map((p) => (
              <span key={p.userId} className="bg-blue-900 text-blue-300 text-sm px-3 py-1 rounded-full">
                {p.userName}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
