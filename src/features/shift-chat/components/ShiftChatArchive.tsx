import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/lib/api";
import type { ShiftMessage } from "../types";
import { MessageBubble } from "./MessageBubble";
import { BroadcastCard } from "./BroadcastCard";
import { SystemCard } from "./SystemCard";
import { useAuth } from "@/hooks/use-auth";

interface ArchiveResponse {
  messages: ShiftMessage[];
  shift: { id: string; startedAt: string; endedAt: string | null };
}

export function ShiftChatArchive() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const { userId } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/shift-chat/archive", shiftId],
    queryFn: () => request<ArchiveResponse>(`/api/shift-chat/archive/${shiftId}`),
    enabled: !!shiftId,
  });

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">טוען...</div>;
  if (!data) return <div className="p-6 text-muted-foreground text-sm">לא נמצא</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-3">
      <div className="mb-4">
        <h1 className="text-lg font-bold">ארכיון צ׳אט משמרת</h1>
        <p className="text-xs text-muted-foreground">
          {new Date(data.shift.startedAt).toLocaleString("he-IL")}
          {data.shift.endedAt && ` — ${new Date(data.shift.endedAt).toLocaleString("he-IL")}`}
        </p>
        <p className="text-xs text-muted-foreground mt-1 bg-[var(--status-stale-bg)] border border-[var(--status-stale-border)] rounded px-2 py-1 inline-block">
          קריאה בלבד
        </p>
      </div>
      {data.messages.map((msg) => {
        if (msg.type === "system") return <SystemCard key={msg.id} message={msg} />;
        if (msg.type === "broadcast") return (
          <BroadcastCard
            key={msg.id}
            message={msg}
            currentUserId={userId ?? null}
            isSender={msg.senderId === userId}
            onAck={() => {}}
          />
        );
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            currentUserId={userId ?? null}
            onReact={() => {}}
            canPin={false}
          />
        );
      })}
      {data.messages.length === 0 && (
        <p className="text-center text-muted-foreground text-sm">אין הודעות בארכיון</p>
      )}
    </div>
  );
}
