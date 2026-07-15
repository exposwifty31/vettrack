import { Component, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { queryClient } from "@/lib/queryClient";
import { t } from "@/lib/i18n";
import { safeReloadPage } from "@/lib/safe-browser";
import { isChunkLoadError, recoverFromChunkLoadFailure } from "@/lib/chunk-load-recovery";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

function RecoveryActions({ onRetry }: { onRetry: () => void }) {
  const { refreshAuth } = useAuth();

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          queryClient.clear();
          refreshAuth();
          onRetry();
        }}
      >
        <RefreshCw className="w-3.5 h-3.5 me-1.5" />
        {t.errorCard.retry}
      </Button>
      <Button size="sm" onClick={() => safeReloadPage()}>
        {t.errorCard.refreshPage}
      </Button>
    </div>
  );
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
    Sentry.captureException(error, {
      extra: {
        componentStack: info.componentStack,
      },
    });
    const msg = error instanceof Error ? error.message : String(error);
    if (isChunkLoadError(msg)) {
      void recoverFromChunkLoadFailure({ unregisterServiceWorkers: true });
    }
  }

  private reset = () => {
    if (isChunkLoadError(this.state.errorMessage)) {
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
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background" data-testid="app-error-boundary">
        <div className="w-full max-w-md rounded-2xl border border-destructive/30 bg-destructive/5 p-6 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive opacity-80" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">{t.errorCard.defaultMessage}</h1>
            {this.state.errorMessage ? (
              <p className="text-xs text-muted-foreground font-mono break-all">{this.state.errorMessage}</p>
            ) : null}
          </div>
          <RecoveryActions onRetry={this.reset} />
        </div>
      </div>
    );
  }
}
