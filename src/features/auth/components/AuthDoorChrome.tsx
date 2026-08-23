import type { ReactNode } from "react";
import { Link } from "wouter";
import { VetTrackMark } from "@/components/vettrack-mark";
import { cn } from "@/lib/utils";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { useIsNativeTablet } from "@/native/tablet/useIsNativeTablet";

export type AuthDoorVariant = "web" | "phone" | "tablet";

interface AuthDoorChromeProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Test override — production resolves from Capacitor + tablet hooks. */
  variant?: AuthDoorVariant;
}

function AuthDoorBrand({
  title,
  subtitle,
  align,
}: {
  title: string;
  subtitle: string;
  align: "center" | "start";
}) {
  return (
    <div className={cn("mb-6", align === "center" ? "text-center" : "text-start")}>
      <Link
        href="/"
        className="mb-5 inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-bg"
      >
        <VetTrackMark size={align === "center" ? 36 : 40} />
        <span className="vt-title text-ivory-text">VetTrack</span>
      </Link>
      <h1 className="vt-page-title text-ivory-text text-balance" data-testid="auth-door-title">
        {title}
      </h1>
      <p className="vt-text-sm mt-2 text-ivory-text2 text-pretty">{subtitle}</p>
    </div>
  );
}

/**
 * Clinic-door chrome for /signin and /signup.
 *
 * - web: contained Ivory sheet (management console — rare auth path)
 * - phone / tablet (Capacitor): full-bleed top-aligned app door — no floating
 *   card, no vertical centering, no extra safe-area padding (NativeShell owns SAT)
 */
export function AuthDoorChrome({
  title,
  subtitle,
  children,
  footer,
  className,
  variant: variantOverride,
}: AuthDoorChromeProps) {
  const isNativeTablet = useIsNativeTablet();
  const variant: AuthDoorVariant =
    variantOverride ??
    (!isCapacitorNative() ? "web" : isNativeTablet ? "tablet" : "phone");

  if (variant === "web") {
    return (
      <div
        className={cn(
          "min-h-[100dvh] bg-ivory-bg text-ivory-text flex flex-col items-center justify-center px-4 py-8",
          className,
        )}
        data-auth-door-variant="web"
      >
        <div
          data-testid="auth-door-sheet"
          className="w-full max-w-sm rounded-2xl border border-ivory-border bg-ivory-surface p-6 shadow-card sm:p-7"
        >
          <AuthDoorBrand title={title} subtitle={subtitle} align="center" />
          {children}
        </div>
        {footer ? (
          <div className="mt-6 w-full max-w-sm text-center space-y-3">{footer}</div>
        ) : null}
      </div>
    );
  }

  // Native phone + tablet: fill the NativeShell viewport; do not re-apply
  // 100dvh centering or safe-area padding (NativeShell already pads SAT/SAB).
  const isTablet = variant === "tablet";

  return (
    <div
      className={cn(
        "flex min-h-full flex-col bg-ivory-bg text-ivory-text",
        isTablet ? "px-8 py-8 sm:px-10" : "px-5 pt-6 pb-8",
        className,
      )}
      data-auth-door-variant={variant}
    >
      <div
        data-testid="auth-door-sheet"
        className={cn(
          "flex w-full flex-1 flex-col",
          isTablet &&
            "mx-auto max-w-lg [@media(orientation:landscape)_and_(min-width:900px)]:max-w-4xl",
        )}
      >
        <div
          className={cn(
            "flex flex-1 flex-col",
            isTablet &&
              "[@media(orientation:landscape)_and_(min-width:900px)]:grid [@media(orientation:landscape)_and_(min-width:900px)]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] [@media(orientation:landscape)_and_(min-width:900px)]:items-start [@media(orientation:landscape)_and_(min-width:900px)]:gap-12",
          )}
        >
          <AuthDoorBrand title={title} subtitle={subtitle} align="start" />
          <div className="w-full min-w-0">{children}</div>
        </div>
        {footer ? (
          <div className="mt-auto w-full pt-10 text-center space-y-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
