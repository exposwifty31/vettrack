import { t } from "@/lib/i18n";
import { AppShell } from "@/components/layout/AppShell";
import { Helmet } from "react-helmet-async";
import {
  QrCode,
  LogIn,
  LogOut,
  AlertTriangle,
  BellRing,
  Radar,
  Wifi,
  WifiOff,
  CheckCircle2,
  Clock,
  XCircle,
  Nfc,
  Droplets,
  Wrench,
  Package,
  HelpCircle,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { LegalFooterLinks } from "@/components/legal-footer-links";
import { getBundledAppVersion } from "@/lib/app-version";

interface CheatItemProps {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
}

function CheatItem({ icon: Icon, iconBg, iconColor, title, description }: CheatItemProps) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/60 last:border-0">
      <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground leading-snug">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/60 rounded-2xl shadow-sm overflow-hidden">
      <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground px-4 pt-4 pb-1">
        {title}
      </p>
      <div className="px-4 pb-1">{children}</div>
    </div>
  );
}

export default function HelpPage() {
  return (
    <AppShell>
      <Helmet>
        <title>{t.helpPage.titleFull}</title>
      </Helmet>

      <div className="flex flex-col gap-5 pb-20 animate-fade-in">
        {/* Header */}
        <div className="flex items-start gap-3 pt-1">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{t.helpPage.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t.helpPage.subtitle}</p>
          </div>
        </div>

        {/* Daily tasks */}
        <Section title={t.helpPage.dailyTasks}>
          <CheatItem
            icon={QrCode}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            title={t.helpPage.scanQrTitle}
            description={t.helpPage.scanQrDescription}
          />
          <CheatItem
            icon={LogIn}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            title={t.helpPage.checkoutTitle}
            description={t.helpPage.checkoutDescription}
          />
          <CheatItem
            icon={LogOut}
            iconBg="bg-[var(--status-ok-bg)]"
            iconColor="text-[var(--status-ok-fg)]"
            title={t.helpPage.returnTitle}
            description={t.helpPage.returnDescription}
          />
          <CheatItem
            icon={AlertTriangle}
            iconBg="bg-[var(--status-issue-bg)]"
            iconColor="text-[var(--status-issue-fg)]"
            title={t.helpPage.reportIssueTitle}
            description={t.helpPage.reportIssueDescription}
          />
        </Section>

        {/* Status badges */}
        <Section title={t.helpPage.equipmentStatus}>
          <CheatItem
            icon={CheckCircle2}
            iconBg="bg-[var(--status-ok-bg)]"
            iconColor="text-[var(--status-ok-fg)]"
            title={t.helpPage.okTitle}
            description={t.helpPage.okDescription}
          />
          <CheatItem
            icon={Droplets}
            iconBg="bg-[var(--status-sterilized-bg)]"
            iconColor="text-[var(--status-sterilized-fg)]"
            title={t.helpPage.sterilizedTitle}
            description={t.helpPage.sterilizedDescription}
          />
          <CheatItem
            icon={Wrench}
            iconBg="bg-[var(--status-stale-bg)]"
            iconColor="text-[var(--status-stale-fg)]"
            title={t.helpPage.maintenanceTitle}
            description={t.helpPage.maintenanceDescription}
          />
          <CheatItem
            icon={AlertTriangle}
            iconBg="bg-[var(--status-issue-bg)]"
            iconColor="text-[var(--status-issue-fg)]"
            title={t.helpPage.issueTitle}
            description={t.helpPage.issueDescription}
          />
          <CheatItem
            icon={Package}
            iconBg="bg-muted"
            iconColor="text-muted-foreground"
            title={t.helpPage.inactiveTitle}
            description={t.helpPage.inactiveDescription}
          />
        </Section>

        {/* Asset Radar */}
        <Section title={t.helpPage.assetRadar}>
          <CheatItem
            icon={Radar}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            title={t.helpPage.healthRingTitle}
            description={t.helpPage.healthRingDescription}
          />
          <CheatItem
            icon={CheckCircle2}
            iconBg="bg-[var(--status-ok-bg)]"
            iconColor="text-[var(--status-ok-fg)]"
            title={t.helpPage.syncedTitle}
            description={t.helpPage.syncedDescription}
          />
          <CheatItem
            icon={Clock}
            iconBg="bg-[var(--status-stale-bg)]"
            iconColor="text-[var(--status-stale-fg)]"
            title={t.helpPage.staleTitle}
            description={t.helpPage.staleDescription}
          />
          <CheatItem
            icon={AlertTriangle}
            iconBg="bg-[var(--status-issue-bg)]"
            iconColor="text-[var(--status-issue-fg)]"
            title={t.helpPage.auditRequiredTitle}
            description={t.helpPage.auditRequiredDescription}
          />
          <CheatItem
            icon={Nfc}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            title={t.helpPage.nfcTitle}
            description={t.helpPage.nfcDescription}
          />
        </Section>

        {/* Sync indicator */}
        <Section title={t.helpPage.syncIndicator}>
          <CheatItem
            icon={Clock}
            iconBg="bg-muted"
            iconColor="text-muted-foreground"
            title={t.helpPage.pendingTitle}
            description={t.helpPage.pendingDescription}
          />
          <CheatItem
            icon={CheckCircle2}
            iconBg="bg-[var(--status-ok-bg)]"
            iconColor="text-[var(--status-ok-fg)]"
            title={t.helpPage.syncedTitle}
            description={t.helpPage.syncedDescription}
          />
          <CheatItem
            icon={XCircle}
            iconBg="bg-[var(--status-issue-bg)]"
            iconColor="text-[var(--status-issue-fg)]"
            title={t.helpPage.failedTitle}
            description={t.helpPage.failedDescription}
          />
          <CheatItem
            icon={WifiOff}
            iconBg="bg-[var(--status-stale-bg)]"
            iconColor="text-[var(--status-stale-fg)]"
            title={t.helpPage.offlineTitle}
            description={t.helpPage.offlineDescription}
          />
        </Section>

        {/* Alerts */}
        <Section title={t.helpPage.alerts}>
          <CheatItem
            icon={BellRing}
            iconBg="bg-[var(--status-issue-bg)]"
            iconColor="text-[var(--status-issue-fg)]"
            title={t.helpPage.activeAlertsTitle}
            description={t.helpPage.activeAlertsDescription}
          />
          <CheatItem
            icon={Wifi}
            iconBg="bg-primary/10"
            iconColor="text-primary"
            title={t.helpPage.pushAlertsTitle}
            description={t.helpPage.pushAlertsDescription}
          />
        </Section>

        {/* Legal */}
        <Section title={t.helpPage.legal}>
          <div className="py-3">
            <LegalFooterLinks className="justify-start gap-x-5" />
          </div>
        </Section>

        <p className="text-center text-xs text-muted-foreground font-mono">
          VetTrack v{getBundledAppVersion()}
        </p>

        <div className="text-center pt-2 pb-4">
          <Link href="/home">
            <Button variant="outline" className="gap-2 h-11">
              {t.helpPage.backToDashboard}
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
