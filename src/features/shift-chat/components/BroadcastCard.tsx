import { BROADCAST_TEMPLATES, type BroadcastKey, type ShiftMessage } from "../types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface BroadcastCardProps {
  message: ShiftMessage;
  currentUserId: string | null;
  isSender: boolean;
  onAck: (status: "acknowledged" | "snoozed") => void;
}

export function BroadcastCard({ message, currentUserId, isSender, onAck }: BroadcastCardProps) {
  const key = message.broadcastKey as BroadcastKey | null;
  const template = key && key in BROADCAST_TEMPLATES ? t.shiftChat.broadcastTemplates[key] : null;

  const myAck = message.acks.find((a) => a.userId === currentUserId);
  const totalTechs = message.acks.length;
  const ackedCount = message.acks.filter((a) => a.status === "acknowledged").length;

  return (
    <div className="rounded-xl border border-primary bg-primary/10 p-3 my-1">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">📢</span>
        <span className="text-xs text-primary font-semibold">
          {isSender ? t.shiftChat.broadcast.iSent : (message.senderName ?? t.shiftChat.broadcast.seniorTech)}
        </span>
      </div>

      <div className="text-base font-bold text-foreground mb-0.5">
        {template?.label ?? message.broadcastKey}
      </div>
      {template?.subtitle && (
        <div className="text-xs text-muted-foreground mb-3">{template.subtitle}</div>
      )}

      {isSender && totalTechs > 0 && (
        <div className="mt-1">
          <div className="h-1 bg-muted rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-[hsl(var(--status-ok))] rounded-full transition-all"
              style={{ width: `${(ackedCount / totalTechs) * 100}%` }}
            />
          </div>
          <div className="text-[10px] text-[var(--status-ok-fg)] font-semibold mb-2">
            ✓ {ackedCount} / {totalTechs} {t.shiftChat.broadcast.received}
          </div>
          <div className="flex flex-wrap gap-1">
            {message.acks.map((ack) => (
              <span
                key={ack.userId}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-semibold",
                  ack.status === "acknowledged"
                    ? "bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]"
                    : "bg-[var(--status-issue-bg)] text-[var(--status-issue-fg)]",
                )}
              >
                {ack.status === "acknowledged" ? "✓" : "⏳"} {ack.userId.slice(0, 6)}
              </span>
            ))}
          </div>
        </div>
      )}

      {!isSender && !myAck && (
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => onAck("acknowledged")}
            type="button"
            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg py-2 text-sm font-bold transition-colors"
          >
            ✓ {t.shiftChat.broadcast.gotItOnWay}
          </button>
          <button
            onClick={() => onAck("snoozed")}
            type="button"
            className="bg-transparent border border-border text-muted-foreground rounded-lg px-3 py-2 text-xs transition-colors hover:border-primary"
          >
            ⏱ {t.shiftChat.broadcast.fiveMin}
          </button>
        </div>
      )}

      {!isSender && myAck && (
        <div className="text-xs text-[var(--status-ok-fg)] font-semibold">
          {myAck.status === "acknowledged"
            ? `✓ ${t.shiftChat.broadcast.ackedReceipt}`
            : `⏱ ${t.shiftChat.broadcast.snoozedReminder}`}
        </div>
      )}
    </div>
  );
}
