import { cn } from "@/lib/utils";
import type { ShiftMessage } from "../types";
import { t } from "@/lib/i18n";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface MessageBubbleProps {
  message: ShiftMessage;
  currentUserId: string | null;
  onReact: (emoji: "👍" | "✅" | "👀") => void;
  onPin?: () => void;
  canPin: boolean;
}

const EMOJIS = ["👍", "✅", "👀"] as const;

export function MessageBubble({ message, currentUserId, onReact, onPin, canPin }: MessageBubbleProps) {
  const isMe = message.senderId === currentUserId;

  const reactionCounts = EMOJIS.map((e) => ({
    emoji: e,
    count: message.reactions.filter((r) => r.emoji === e).length,
    mine:  message.reactions.some((r) => r.emoji === e && r.userId === currentUserId),
  })).filter((r) => r.count > 0);

  return (
    <div className={cn("flex gap-2 items-end", isMe && "flex-row-reverse")}>
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0",
          message.senderRole === "vet" ? "bg-[var(--status-in-use-bg)] text-[var(--status-in-use-fg)]" :
          message.senderRole === "senior_technician" ? "bg-[var(--status-in-use-bg)] text-[var(--status-in-use-fg)]" :
          "bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]",
        )}
      >
        {(message.senderName ?? "?").slice(0, 2)}
      </div>

      <div className={cn("max-w-[72%]", isMe && "items-end flex flex-col")}>
        {!isMe && (
          <div className="text-xs text-muted-foreground mb-0.5">{message.senderName}</div>
        )}

        <div
          className={cn(
            "px-3 py-2 rounded-2xl text-sm leading-snug",
            isMe
              ? "bg-[var(--brand)] text-[var(--on-ink)] rounded-bl-sm"
              : "bg-muted text-foreground rounded-br-sm",
            message.isUrgent && "bg-[var(--status-issue-bg)] border border-[var(--status-issue-border)] text-[var(--status-issue-fg)]",
          )}
        >
          {message.isUrgent && (
            <div className="text-[9px] font-bold text-[var(--status-issue-fg)] tracking-wide mb-1">⚡ דחוף</div>
          )}
          <span
            dangerouslySetInnerHTML={{
              __html: escapeHtml(message.body)
                .replace(/@(\S+)/g, '<span class="text-[var(--brand)] font-semibold">@$1</span>')
                .replace(/#(\S+)/g, '<span class="text-[var(--brand)] underline cursor-pointer font-semibold">#$1</span>'),
            }}
          />
        </div>

        {reactionCounts.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {reactionCounts.map(({ emoji, count, mine }) => (
              <button
                key={emoji}
                onClick={() => onReact(emoji as "👍" | "✅" | "👀")}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
                  mine
                    ? "bg-[var(--brand-soft)] border-[var(--brand-border)] text-[var(--brand)]"
                    : "bg-muted border-border text-muted-foreground",
                )}
              >
                {emoji} <span>{count}</span>
              </button>
            ))}
          </div>
        )}

        <div className={cn("flex gap-1 mt-1", isMe && "justify-end")}>
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => onReact(e)}
              className="text-xs opacity-30 hover:opacity-100 transition-opacity"
              title={`React with ${e}`}
            >
              {e}
            </button>
          ))}
          {canPin && (
            <button
              onClick={onPin}
              className="text-xs opacity-30 hover:opacity-100 transition-opacity ms-1"
              title={t.shiftChat.panel.pinAria}
              aria-label={t.shiftChat.panel.pinAria}
            >
              📌
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
