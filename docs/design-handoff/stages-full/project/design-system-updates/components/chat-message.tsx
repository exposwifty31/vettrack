// Lands at: src/components/general/chat-message.tsx
// §21-D2 — genuinely new; no real equivalent exists in the bundle yet. The
// chat *pattern* is NOT frozen scope (only ER/meds *content* is per the
// Equipment Hero PRD) — ships here with non-clinical example copy.
import * as React from "react";
import { cn } from "@/lib/utils";

export interface ChatMessageProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "normal" | "broadcast" | "urgent";
  /** Sender display name. Always shown for broadcast/urgent; shown for
   * "normal" only when `own` is false. */
  from: string;
  /** True when the signed-in user sent this — aligns to the reading-end via
   * logical margin utilities (ms-auto/me-auto), so it's correct in RTL too. */
  own?: boolean;
  children: React.ReactNode;
  /** Broadcast only, 0-100. Always pair with ackLabel — never show a bare bar
   * with no count (mirrors the Equipment Hero PRD's "never fake precision"). */
  ackPercent?: number;
  ackLabel?: string;
}

export function ChatMessage({
  variant = "normal",
  from,
  own = false,
  children,
  ackPercent,
  ackLabel,
  className,
  ...props
}: ChatMessageProps) {
  if (variant === "broadcast") {
    return (
      <div
        className={cn(
          "rounded-2xl border-[1.5px] border-primary bg-primary/5 p-4",
          className,
        )}
        {...props}
      >
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          📢 {from}
        </p>
        <p className="text-base font-bold text-foreground">{children}</p>
        {typeof ackPercent === "number" ? (
          <>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--status-ok-fg)]"
                style={{ width: `${ackPercent}%` }}
              />
            </div>
            {ackLabel ? (
              <p className="font-num mt-1 text-xs font-semibold text-[var(--status-ok-fg)]">
                {ackLabel}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }

  if (variant === "urgent") {
    return (
      <div
        className={cn(
          "max-w-[78%] rounded-2xl border border-[var(--status-issue-border)] bg-[var(--status-issue-bg)] p-3",
          own ? "ms-auto" : "me-auto",
          className,
        )}
        {...props}
      >
        <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--status-issue-fg)]">
          {from} · Urgent
        </p>
        <p className="text-sm font-medium text-foreground">{children}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex max-w-[78%] flex-col gap-0.5",
        own ? "ms-auto items-end" : "me-auto items-start",
        className,
      )}
      {...props}
    >
      {!own ? (
        <span className="px-1 text-xs font-medium text-muted-foreground">
          {from}
        </span>
      ) : null}
      <div
        className={cn(
          "rounded-2xl px-3.5 py-2 text-sm font-medium",
          own ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {children}
      </div>
    </div>
  );
}
