import { useRef, useEffect, useState, useCallback } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { useShiftChat } from "../hooks/useShiftChat";
import { MessageBubble } from "./MessageBubble";
import { BroadcastCard } from "./BroadcastCard";
import { SystemCard } from "./SystemCard";
import { BROADCAST_TEMPLATES, type BroadcastKey } from "../types";
import { useAuth } from "@/hooks/use-auth";
import { t } from "@/lib/i18n";

type ChatState = ReturnType<typeof useShiftChat>;

interface ShiftChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chat: ChatState;
}

const UNIQUE_ROOM_TAGS = (msgs: { roomTag: string | null }[]) =>
  [...new Set(msgs.map((m) => m.roomTag).filter(Boolean))] as string[];

export function ShiftChatPanel({ isOpen, onClose, chat }: ShiftChatPanelProps) {
  const { role, effectiveRole, userId } = useAuth();
  const { sendMessage, isSending, notifyTyping, ackMessage, reactToMessage, pinMessage } = chat;
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const [body, setBody]               = useState("");
  const [isUrgent, setIsUrgent]       = useState(false);
  const [roomFilter, setRoomFilter]   = useState<string | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);

  const canSendBroadcast = effectiveRole === "senior_technician" || role === "senior_technician" ||
    effectiveRole === "admin" || role === "admin";
  const canPin = effectiveRole === "vet" || role === "vet" ||
    effectiveRole === "senior_technician" || role === "senior_technician" ||
    effectiveRole === "admin" || role === "admin";

  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chat.messages.length, isOpen]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const filteredMessages = roomFilter
    ? chat.messages.filter((m) => m.roomTag === roomFilter || m.type === "system")
    : chat.messages;

  const handleSend = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed && !showBroadcast) return;

    sendMessage({
      body: trimmed,
      type: "regular",
      isUrgent,
      mentionedUserIds: [],
    });

    setBody("");
    setIsUrgent(false);
  }, [body, isUrgent, sendMessage, showBroadcast]);

  const handleBroadcast = (key: BroadcastKey) => {
    sendMessage({ body: "", type: "broadcast", broadcastKey: key });
    setShowBroadcast(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
    notifyTyping();
  };

  const roomTags = UNIQUE_ROOM_TAGS(chat.messages);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="max-h-[92dvh] p-0 flex flex-col rounded-t-2xl"
      >

        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_6px_theme(colors.green.500)]" />
            <span className="font-bold text-sm">צ׳אט משמרת</span>
            <span className="text-xs text-muted-foreground">
              {chat.onlineUserIds.length} מחוברים
            </span>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
        </div>

        {chat.pinnedMessage && (
          <div className="px-3 py-2 bg-amber-950/40 border-b border-amber-800/50 flex items-start gap-2 flex-shrink-0">
            <span className="text-xs">📌</span>
            <p className="text-xs text-amber-300 leading-snug line-clamp-2">
              {chat.pinnedMessage.body}
            </p>
          </div>
        )}

        {roomTags.length > 0 && (
          <div className="flex gap-2 px-3 py-2 overflow-x-auto scrollbar-none border-b border-border flex-shrink-0">
            <button
              onClick={() => setRoomFilter(null)}
              className={cn(
                "px-3 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap",
                !roomFilter
                  ? "bg-blue-900 border-blue-500 text-blue-200"
                  : "bg-muted border-border text-muted-foreground",
              )}
            >
              הכל
            </button>
            {roomTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setRoomFilter(tag === roomFilter ? null : tag)}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap",
                  roomFilter === tag
                    ? "bg-blue-900 border-blue-500 text-blue-200"
                    : "bg-muted border-border text-muted-foreground",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {chat.isLoading && (
            <p className="text-center text-muted-foreground text-xs">טוען...</p>
          )}
          {!chat.isLoading && filteredMessages.length === 0 && (
            <p className="text-center text-muted-foreground text-xs">אין הודעות עדיין</p>
          )}
          {filteredMessages.map((msg) => {
            if (msg.type === "system") {
              return <SystemCard key={msg.id} message={msg} />;
            }
            if (msg.type === "broadcast") {
              return (
                <BroadcastCard
                  key={msg.id}
                  message={msg}
                  currentUserId={userId ?? null}
                  isSender={msg.senderId === userId}
                  onAck={(status) => ackMessage({ id: msg.id, status })}
                />
              );
            }
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                currentUserId={userId ?? null}
                onReact={(emoji) => reactToMessage({ messageId: msg.id, emoji })}
                onPin={() => pinMessage(msg.id)}
                canPin={canPin}
              />
            );
          })}

          {chat.typing.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground italic px-1">
              <span>{chat.typing.join(", ")} מקליד...</span>
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {showBroadcast && canSendBroadcast && (
          <div className="px-3 pb-2 border-t border-border flex-shrink-0">
            <p className="text-[10px] text-muted-foreground mb-2 pt-2">בחר פקודת שידור:</p>
            {(Object.entries(BROADCAST_TEMPLATES) as [BroadcastKey, { label: string; subtitle: string }][]).map(([key, t]) => (
              <button
                key={key}
                onClick={() => handleBroadcast(key)}
                className="w-full text-right bg-indigo-950 hover:bg-indigo-900 border border-indigo-800 rounded-lg px-3 py-2 mb-1"
              >
                <div className="text-sm font-bold text-indigo-100">{t.label}</div>
                <div className="text-[10px] text-indigo-300">{t.subtitle}</div>
              </button>
            ))}
            <button type="button" onClick={() => setShowBroadcast(false)} className="text-xs text-muted-foreground mt-1">{t.common.cancel}</button>
          </div>
        )}

        <div className="px-3 pb-4 pt-2 border-t border-border flex items-center gap-2 flex-shrink-0">
          {canSendBroadcast && (
            <button
              type="button"
              onClick={() => setShowBroadcast((v) => !v)}
              className="bg-indigo-950 border border-indigo-700 text-indigo-400 rounded-lg p-2 text-sm flex-shrink-0"
              aria-label="שלח פקודה"
            >
              📢
            </button>
          )}
          <div className="flex-1 bg-background border border-border rounded-2xl flex items-center px-3 gap-2 min-h-[36px]">
            <textarea
              ref={inputRef}
              value={body}
              onChange={handleBodyChange}
              onKeyDown={handleKeyDown}
              placeholder="כתוב הודעה..."
              rows={1}
              className="flex-1 bg-transparent text-sm resize-none outline-none py-2 leading-snug"
              style={{ maxHeight: "80px" }}
            />
            <button
              type="button"
              onClick={() => setIsUrgent((v) => !v)}
              className={cn("text-sm flex-shrink-0", isUrgent ? "text-red-400" : "text-muted-foreground/40")}
              aria-label="סמן כדחוף"
            >
              ⚡
            </button>
          </div>
          <button
            onClick={handleSend}
            disabled={!body.trim() || isSending}
            className="bg-gradient-to-br from-[var(--brand)] to-[var(--brand-deep)] text-white rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 disabled:opacity-40"
            aria-label="שלח"
          >
            ➤
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
