import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { isChunkLoadError, recoverFromChunkLoadFailure } from "@/lib/chunk-load-recovery";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Lightweight per-section error boundary.
 * Wraps a page section so a single component crash cannot take down the
 * entire page. Shows a compact inline error card with a retry button.
 */
export class PageErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error("[PageErrorBoundary]", error, info.componentStack);
    const msg = error instanceof Error ? error.message : String(error);
    if (isChunkLoadError(msg)) {
      // Auto-recover: a failed lazy-import chunk is almost always a stale
      // cache after deploy. The sessionStorage guard inside the helper
      // prevents reload loops if recovery doesn't fix it.
      void recoverFromChunkLoadFailure({ unregisterServiceWorkers: true });
    }
  }

  reset = () => {
    if (isChunkLoadError(this.state.errorMessage)) {
      // User-initiated retry: force past the session loop guard so the button
      // can never silently become a no-op.
      void recoverFromChunkLoadFailure({
        unregisterServiceWorkers: true,
        force: true,
      }).then((reloaded) => {
        if (!reloaded) {
          this.setState({ hasError: false, errorMessage: "" });
        }
      });
      return;
    }
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-5 flex flex-col items-center gap-3 text-center my-2" data-testid="page-error-boundary">
          <AlertTriangle className="w-6 h-6 text-destructive opacity-70" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {this.props.fallbackLabel ?? t.pageErrorBoundary.defaultFallback}
            </p>
            {this.state.errorMessage && (
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {this.state.errorMessage}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-9 text-xs"
            onClick={this.reset}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t.pageErrorBoundary.tryAgain}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
