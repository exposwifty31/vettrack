import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { safeReloadPage } from "@/lib/safe-browser";

const MAX_RESETS_PER_WINDOW = 3;
const RESET_WINDOW_MS = 60_000;
const RESET_DELAY_MS = 2_000;

interface BoardErrorBoundaryProps {
  children: ReactNode;
  resetSeq: number;
  onRequestReset: () => void;
}

interface BoardErrorBoundaryState {
  hasError: boolean;
}

/**
 * Kiosk-grade error boundary for the /board subtree. A wall display has no
 * operator, so a crash must NEVER leave a blank white screen or a stack trace:
 *   - catch → dark "reconnecting" panel.
 *   - bounded auto-reset: after a short delay, bump the parent's resetSeq, which
 *     remounts the children — a clean SSE teardown + rebuild inside the screen.
 *   - storm guard: more than MAX_RESETS_PER_WINDOW crashes in the rolling window
 *     escalates to a throttled full-page reload (safeReloadPage self-throttles to
 *     one reload / 5 s) instead of reset-looping the panel forever.
 * React has no functional error-boundary equivalent, so this stays a class.
 * The boundary wraps ONLY the board children — the shell's wake-lock + reload
 * machinery are siblings, so a subtree crash can't take out the recovery path.
 */
export class BoardErrorBoundary extends Component<BoardErrorBoundaryProps, BoardErrorBoundaryState> {
  state: BoardErrorBoundaryState = { hasError: false };
  private resetTimestamps: number[] = [];
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): BoardErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[board] subtree crash — recovering", error, info.componentStack);
    const now = Date.now();
    this.resetTimestamps = this.resetTimestamps.filter((ts) => now - ts < RESET_WINDOW_MS);
    this.resetTimestamps.push(now);
    if (this.resetTimestamps.length > MAX_RESETS_PER_WINDOW) {
      // Reset storming — a soft remount isn't clearing it. Escalate to a
      // throttled full reload instead of looping the reconnecting panel.
      safeReloadPage();
      return;
    }
    this.clearPending();
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.props.onRequestReset();
    }, RESET_DELAY_MS);
  }

  componentDidUpdate(prevProps: BoardErrorBoundaryProps): void {
    // Parent bumped resetSeq (from onRequestReset) → clear the error so the
    // children remount fresh. This is the clean teardown+rebuild of the SSE
    // connection owned by CommandBoardScreen.
    if (this.state.hasError && prevProps.resetSeq !== this.props.resetSeq) {
      this.setState({ hasError: false });
    }
  }

  componentWillUnmount(): void {
    this.clearPending();
  }

  private clearPending(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white/80"
          dir="rtl"
          role="status"
          aria-live="polite"
          data-testid="board-error-recovering"
        >
          <span
            className="h-3 w-3 rounded-full bg-[hsl(var(--status-ok))] motion-safe:animate-pulse"
            aria-hidden
          />
          <span className="vt-text-sm">{t.board.loading}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
