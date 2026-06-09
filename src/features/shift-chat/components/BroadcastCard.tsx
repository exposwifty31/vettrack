import { BROADCAST_TEMPLATES, type ShiftMessage } from "../types";
import { cn } from "@/lib/utils";

interface BroadcastCardProps {
  message: ShiftMessage;
  currentUserId: string | null;
  isSender: boolean;
  onAck: (status: "acknowledged" | "snoozed") => void;
}

export function BroadcastCard({ message, currentUserId, isSender, onAck }: BroadcastCardProps) {
  const template = message.broadcastKey
    ? BROADCAST_TEMPLATES[message.broadcastKey as keyof typeof BROADCAST_TEMPLATES]
    : null;

  const myAck = message.acks.find((a) => a.userId === currentUserId);
  const totalTechs = message.acks.length;
  const ackedCount = message.acks.filter((a) => a.status === "acknowledged").length;

  return (
    <div className="rounded-xl border border-indigo-500 bg-indigo-950/60 p-3 my-1">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">📢</span>
        <span className="text-xs text-indigo-300 font-semibold">
          {isSender ? "שלחתי" : (message.senderName ?? "טכנאית בכירה")}
        </span>
      </div>

      <div className="text-base font-bold text-indigo-100 mb-0.5">
        {template?.label ?? message.broadcastKey}
      </div>
      {template?.subtitle && (
        <div className="text-xs text-indigo-300 mb-3">{template.subtitle}</div>
      )}

      {isSender && totalTechs > 0 && (
        <div className="mt-1">
          <div className="h-1 bg-indigo-900 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-green-400 rounded-full transition-all"
              style={{ width: `${(ackedCount / totalTechs) * 100}%` }}
            />
          </div>
          <div className="text-[10px] text-green-400 font-semibold mb-2">
            ✓ {ackedCount} / {totalTechs} קיבלו
          </div>
          <div className="flex flex-wrap gap-1">
            {message.acks.map((ack) => (
              <span
                key={ack.userId}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full font-semibold",
                  ack.status === "acknowledged"
                    ? "bg-green-950 text-green-400"
                    : "bg-red-950 text-red-400",
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
            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-sm font-bold transition-colors"
          >
            ✓ קיבלתי — בדרך
          </button>
          <button
            onClick={() => onAck("snoozed")}
            type="button"
            className="bg-transparent border border-indigo-700 text-indigo-300 rounded-lg px-3 py-2 text-xs transition-colors hover:border-indigo-400"
          >
            ⏱ 5 דק׳
          </button>
        </div>
      )}

      {!isSender && myAck && (
        <div className="text-xs text-green-400 font-semibold">
          {myAck.status === "acknowledged" ? "✓ אישרת קבלה" : "⏱ נדחה — תזכורת בעוד 5 דקות"}
        </div>
      )}
    </div>
  );
}
