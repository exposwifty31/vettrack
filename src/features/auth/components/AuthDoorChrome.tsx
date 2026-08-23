import type { ReactNode } from "react";
import { Link } from "wouter";
import { VetTrackMark } from "@/components/vettrack-mark";
import { cn } from "@/lib/utils";

interface AuthDoorChromeProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Shared clinic-door chrome for /signin and /signup.
 * One Ivory canvas + one surface sheet — mark, title, and form live together.
 * Does not own auth logic; pages pass Clerk / phone / role chips as children.
 */
export function AuthDoorChrome({
  title,
  subtitle,
  children,
  footer,
  className,
}: AuthDoorChromeProps) {
  return (
    <div
      className={cn(
        "min-h-[100dvh] bg-ivory-bg text-ivory-text flex flex-col items-center justify-center px-4 py-8",
        className,
      )}
    >
      <div
        data-testid="auth-door-sheet"
        className="w-full max-w-sm rounded-2xl border border-ivory-border bg-ivory-surface p-6 shadow-card sm:p-7"
      >
        <div className="mb-6 text-center">
          <Link
            href="/"
            className="mb-5 inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-ivory-bg"
          >
            <VetTrackMark size={36} />
            <span className="vt-title text-ivory-text">VetTrack</span>
          </Link>
          <h1 className="vt-page-title text-ivory-text text-balance">{title}</h1>
          <p className="vt-text-sm mt-2 text-ivory-text2 text-pretty">{subtitle}</p>
        </div>
        {children}
      </div>
      {footer ? <div className="mt-6 w-full max-w-sm text-center space-y-3">{footer}</div> : null}
    </div>
  );
}
