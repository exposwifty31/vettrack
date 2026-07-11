// Phase 9 — Display-device pairing kiosk screen (GET /board/pair).
//
// A headless Department Display lands here (no Clerk user). An admin issues a
// short-lived pairing code from the Displays console; the operator types it in,
// we redeem it for a durable device token (POST /api/display/pair/claim),
// persist the token, and hand off to /board. Renders inside BoardShell (dark,
// full-bleed kiosk chrome) because /board/pair matches `isBoardPathname`.
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { MonitorSmartphone, Loader2, TriangleAlert } from "lucide-react";
import { claimDisplayPairing } from "@/lib/api";
import { setStoredDisplayToken, consumeDisplayRevokedNotice } from "@/lib/display-token-store";
import { t } from "@/lib/i18n";
import { useDirection } from "@/hooks/useDirection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Strip spaces/dashes for the 8-char length check; the server normalizes the same way. */
function normalizedLength(raw: string): number {
  return raw.replace(/[\s-]/g, "").length;
}

export default function BoardPairPage() {
  const [, navigate] = useLocation();
  const dir = useDirection();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  // Consumed exactly once on mount — a lazy initializer so the flag is read
  // and cleared before the first paint, not in a post-mount effect.
  const [wasRevoked] = useState(() => consumeDisplayRevokedNotice());

  const mutation = useMutation({
    mutationFn: () => claimDisplayPairing(code.trim(), name.trim() || undefined),
    onSuccess: (result) => {
      setStoredDisplayToken(result.token, result.clinicId);
      navigate("/board", { replace: true });
    },
  });

  const codeValid = normalizedLength(code) === 8;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!codeValid || mutation.isPending) return;
    mutation.mutate();
  }

  return (
    <div
      dir={dir}
      data-testid="board-pair"
      className="dark flex min-h-screen w-full items-center justify-center bg-[rgb(var(--ivory-bg))] p-6 text-ivory-text"
    >
      <div className="w-full max-w-md rounded-2xl border border-ivory-border bg-[rgb(var(--ivory-surface))] p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ivory-greenBg text-ivory-green">
            <MonitorSmartphone className="h-7 w-7" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold">{t.boardPair.title}</h1>
          <p className="text-sm text-ivory-text3">{t.boardPair.subtitle}</p>
        </div>

        {wasRevoked && (
          <div
            role="alert"
            data-testid="board-pair-revoked-notice"
            className="mb-6 flex items-start gap-2.5 rounded-xl border border-emergency-amber/40 bg-emergency-amber/10 px-4 py-3 text-start"
          >
            <TriangleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-emergency-amber"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-emergency-amber">
                {t.boardPair.revokedNoticeTitle}
              </p>
              <p className="mt-0.5 text-xs text-ivory-text2">{t.boardPair.revokedNoticeMessage}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="board-pair-code" className="text-xs font-medium text-ivory-text2">
              {t.boardPair.codeLabel}
            </label>
            <Input
              id="board-pair-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder={t.boardPair.codePlaceholder}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              aria-describedby={mutation.isError ? "board-pair-error" : undefined}
              className="text-center font-mono text-2xl uppercase tracking-[0.3em]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="board-pair-name" className="text-xs font-medium text-ivory-text2">
              {t.boardPair.nameLabel}
            </label>
            <Input
              id="board-pair-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.boardPair.namePlaceholder}
              autoComplete="off"
            />
          </div>

          {mutation.isError && (
            <p id="board-pair-error" role="alert" className="text-sm text-emergency-amber">
              {t.boardPair.error}
            </p>
          )}

          <Button type="submit" disabled={!codeValid || mutation.isPending} className="w-full">
            {mutation.isPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {t.boardPair.pairing}
              </>
            ) : (
              t.boardPair.pairButton
            )}
          </Button>

          <p className="text-center text-xs text-ivory-text3">{t.boardPair.hint}</p>
        </form>
      </div>
    </div>
  );
}
