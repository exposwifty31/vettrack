import { useMobileShellContext } from "@/shell/mobile/MobileShellContext";
import { MobilePageHeader } from "@/shell/mobile/MobilePageHeader";
import { AppShell } from "@/components/layout/AppShell";
import { getBundledAppVersion } from "@/lib/app-version";
import { Link, useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { t } from "@/lib/i18n";

export default function AboutPage() {
  const inMobileShell = useMobileShellContext();
  const [, navigate] = useLocation();
  const version = getBundledAppVersion();

  const content = (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Logo / wordmark — brand name is intentionally not i18n-keyed */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: "var(--text-2xl)", fontWeight: 600, letterSpacing: "-0.03em", color: "hsl(var(--foreground))" }}>
          Vet<em style={{ color: "var(--brand-green-bright)", fontStyle: "normal" }}>Track</em>
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "hsl(var(--muted-foreground))" }}>
          {t.more.about}
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))" }}>
          {t.settingsPage.versionLabel} {version}
        </span>
      </div>

      {/* Links */}
      <div style={{ display: "flex", flexDirection: "column", gap: 0, borderRadius: 12, overflow: "hidden", border: "1px solid hsl(var(--border))" }}>
        {([
          { label: t.settingsPage.support, href: "/support" },
          { label: t.settingsPage.privacyPolicy, href: "/privacy" },
          { label: t.settingsPage.termsOfUse, href: "/terms" },
        ] as const).map(({ label, href }) => (
          <Link
            key={href}
            href={href}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px",
              borderBottom: "1px solid hsl(var(--border))",
              textDecoration: "none",
              color: "hsl(var(--foreground))",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              background: "hsl(var(--card))",
            }}
          >
            {label}
            <ChevronRight size={16} style={{ color: "hsl(var(--muted-foreground))" }} aria-hidden />
          </Link>
        ))}
      </div>

      <p style={{ fontSize: "var(--text-xs)", color: "hsl(var(--muted-foreground))", textAlign: "center", margin: 0 }}>
        © {new Date().getFullYear()} VetTrack
      </p>
    </div>
  );

  if (inMobileShell) {
    return (
      <>
        <MobilePageHeader title={t.more.about} onBack={() => navigate("/home")} />
        {content}
      </>
    );
  }

  return <AppShell>{content}</AppShell>;
}
