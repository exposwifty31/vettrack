import { Link } from "wouter";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type LegalFooterLinksProps = {
  className?: string;
};

export function LegalFooterLinks({ className }: LegalFooterLinksProps) {
  return (
    <nav
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className
      )}
      aria-label={t.legalFooter.ariaLabel}
    >
      <Link
        href="/privacy"
        className="hover:text-primary transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t.legalFooter.privacyPolicy}
      </Link>
      <Link
        href="/terms"
        className="hover:text-primary transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t.legalFooter.termsOfUse}
      </Link>
      <Link
        href="/support"
        className="hover:text-primary transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {t.legalFooter.support}
      </Link>
    </nav>
  );
}
