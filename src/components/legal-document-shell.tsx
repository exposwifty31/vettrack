import type { ReactNode } from "react";
import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { ArrowLeft, QrCode } from "lucide-react";
import { t } from "@/lib/i18n";
import { LegalFooterLinks } from "@/components/legal-footer-links";
import { cn } from "@/lib/utils";

type LegalDocumentShellProps = {
  pageTitle: string;
  metaDescription: string;
  heading: string;
  lastUpdated: string;
  canonicalUrl: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
};

export function LegalDocumentShell({
  pageTitle,
  metaDescription,
  heading,
  lastUpdated,
  canonicalUrl,
  backHref = "/signin",
  backLabel,
  children,
}: LegalDocumentShellProps) {
  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={canonicalUrl} />
      </Helmet>

      <div className="min-h-[100dvh] bg-gradient-to-b from-primary/5 to-background flex flex-col">
        <header className="border-b border-border/60 bg-background/80 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
                <QrCode className="w-4 h-4 text-primary-foreground" aria-hidden />
              </div>
              <span className="text-lg font-bold text-foreground">{t.common.appName}</span>
            </Link>
            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-11 px-2"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden />
              {backLabel ?? t.legalPage.backLink}
            </Link>
          </div>
        </header>

        <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 sm:py-10">
          <header className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight text-balance">
              {heading}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.legalPage.lastUpdatedLabel}: {lastUpdated}
            </p>
          </header>

          <article className={cn("space-y-8 text-foreground")}>{children}</article>
        </main>

        <footer className="border-t border-border/60 py-6 px-4">
          <LegalFooterLinks />
        </footer>
      </div>
    </>
  );
}

export function LegalSection({ title, body }: { title: string; body: string }) {
  const paragraphs = body.split("\n\n").filter(Boolean);

  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-3 text-balance">{title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed max-w-[70ch]">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="text-pretty">
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}
