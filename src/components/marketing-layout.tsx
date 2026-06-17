import type { ReactNode } from "react";
import { Link } from "wouter";
import { LayoutDashboard, ArrowRight } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { VetTrackMark } from "@/components/vettrack-mark";

type MarketingLayoutProps = {
  children: ReactNode;
  showAppCta: boolean;
  showAuthCta: boolean;
};

/**
 * Public marketing shell: mesh background, sticky nav, footer. Copy from `t.landingPage`.
 * Uses shared semantic tokens from `index.css` so the landing route stays aligned with the app theme.
 */
export function MarketingLayout({ children, showAppCta, showAuthCta }: MarketingLayoutProps) {
  const lp = t.landingPage;

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-background text-foreground font-sans antialiased">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[min(70vh,720px)] -z-10"
        style={{
          background: `
            radial-gradient(1200px 500px at 15% -10%, hsl(var(--primary) / 0.12), transparent 55%),
            radial-gradient(900px 420px at 85% 5%, hsl(152 40% 45% / 0.08), transparent 50%),
            linear-gradient(180deg, hsl(var(--muted) / 0.5) 0%, transparent 100%)
          `,
        }}
        aria-hidden
      />

      <header className="sticky top-safe z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 md:h-[4.25rem] flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 group select-none rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            <div className="transition-transform duration-200 group-hover:scale-105 motion-reduce:group-hover:scale-100">
              <VetTrackMark size={36} className="md:hidden" />
              <VetTrackMark size={40} className="hidden md:block" />
            </div>
            <div className="leading-tight">
              <span className="block text-lg md:text-xl font-bold tracking-tight">{t.common.appName}</span>
              <span className="hidden sm:block text-[11px] text-muted-foreground font-medium">
                {lp.navTagline}
              </span>
            </div>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3" aria-label="Marketing">
            {showAppCta && (
              <Link
                href="/home"
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl text-sm font-bold px-4 py-2.5 min-h-11",
                  "bg-primary text-primary-foreground shadow-lg shadow-primary/25",
                  "hover:bg-primary/90 active:scale-[0.98] motion-reduce:active:scale-100 transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                )}
              >
                <LayoutDashboard className="w-4 h-4" aria-hidden />
                {lp.navOpenApp}
              </Link>
            )}
            {showAuthCta && (
              <Link
                href="/signin"
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl text-sm font-bold px-4 py-2.5 min-h-11",
                  "bg-primary text-primary-foreground shadow-lg shadow-primary/25",
                  "hover:bg-primary/90 active:scale-[0.98] motion-reduce:active:scale-100 transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                )}
              >
                {lp.navSignIn}
                <ArrowRight className="w-4 h-4" aria-hidden />
              </Link>
            )}
          </nav>
        </div>
      </header>

      {children}

      <footer className="border-t border-border/60 bg-background py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-start gap-3">
            <VetTrackMark size={36} />
            <div>
              <p className="font-bold text-foreground">{t.common.appName}</p>
              <p className="text-sm text-muted-foreground max-w-sm">{lp.footerTagline}</p>
            </div>
          </div>
          <nav
            className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm text-muted-foreground"
            aria-label={lp.footerNavAria}
          >
            <Link href="/home" className="hover:text-foreground transition-colors">
              {lp.footerAppHome}
            </Link>
            <Link href="/equipment" className="hover:text-foreground transition-colors">
              {lp.footerEquipment}
            </Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              {t.legalFooter.privacyPolicy}
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              {t.legalFooter.termsOfUse}
            </Link>
            <Link href="/support" className="hover:text-foreground transition-colors">
              {t.legalFooter.support}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
