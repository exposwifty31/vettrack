import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

const RELOAD_GUARD_KEY = "vt_peb_reload_guard";

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
  }

  componentDidMount() {
    this.clearReloadGuardIfRecovered();
  }

  componentDidUpdate() {
    this.clearReloadGuardIfRecovered();
  }

  clearReloadGuardIfRecovered = () => {
    if (this.state.hasError) return;
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      // Storage can be unavailable in restricted browser modes.
    }
  };

  reset = () => {
    const isModuleError =
      this.state.errorMessage.includes("Importing binding") ||
      this.state.errorMessage.includes("does not provide an export") ||
      this.state.errorMessage.includes("Failed to fetch dynamically imported");
    if (isModuleError) {
      try {
        if (sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") {
          sessionStorage.removeItem(RELOAD_GUARD_KEY);
          this.setState({ hasError: false, errorMessage: "" });
          return;
        }
        sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
      } catch {
        return;
      }
      if (typeof caches !== "undefined") {
        void caches.keys().then((keys) =>
          Promise.all(
            keys.filter((k) => k.startsWith("vettrack-")).map((k) => caches.delete(k)),
          ),
        ).finally(() => window.location.reload());
      } else {
        window.location.reload();
      }
      return;
    }
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-5 flex flex-col items-center gap-3 text-center my-2">
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
