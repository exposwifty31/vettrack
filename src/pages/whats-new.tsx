import { Helmet } from "react-helmet-async";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { t } from "@/lib/i18n";
import { getBundledAppVersion } from "@/lib/app-version";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tablet,
  Search,
  Bell,
  SunMoon,
  HeartPulse,
} from "lucide-react";

const WHATS_NEW_DISMISSED_KEY = "vt_whats_new_dismissed_version";

/**
 * S10-D3: What's New is a one-time sheet keyed by app version. Dismissal is
 * persisted against the current bundle version, so it re-surfaces only after
 * the app updates to a new version.
 */
export function isWhatsNewDismissed(version: string): boolean {
  try {
    return localStorage.getItem(WHATS_NEW_DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

export function dismissWhatsNew(version: string): void {
  try {
    localStorage.setItem(WHATS_NEW_DISMISSED_KEY, version);
  } catch {
    // storage unavailable (private mode / disabled) — dismissal is best-effort
  }
}

interface ReleaseEntry {
  version: string;
  date: string;
  highlights: {
    icon: React.ReactNode;
    title: string;
    description: string;
    badge?: { label: string; variant: "default" | "secondary" | "outline" };
  }[];
}


export default function WhatsNewPage() {
  const [, navigate] = useLocation();
  // Built inside the component so it re-renders in the active locale. Only the
  // current release is shown — older, outdated entries were removed.
  const wn = t.whatsNew;

  const handleDismiss = () => {
    dismissWhatsNew(getBundledAppVersion());
    navigate("/home");
  };
  const releases: ReleaseEntry[] = [
    {
      version: wn.currentVersion,
      date: wn.currentDate,
      highlights: [
        {
          icon: <Tablet className="w-5 h-5 text-primary" />,
          title: wn.items.ipadExperience.title,
          description: wn.items.ipadExperience.description,
          badge: { label: wn.items.ipadExperience.badge, variant: "default" },
        },
        {
          icon: <Search className="w-5 h-5 text-primary" />,
          title: wn.items.equipmentSearch.title,
          description: wn.items.equipmentSearch.description,
          badge: { label: wn.items.equipmentSearch.badge, variant: "default" },
        },
        {
          icon: <Bell className="w-5 h-5 text-primary" />,
          title: wn.items.alertBell.title,
          description: wn.items.alertBell.description,
          badge: { label: wn.items.alertBell.badge, variant: "secondary" },
        },
        {
          icon: <SunMoon className="w-5 h-5 text-primary" />,
          title: wn.items.appearance.title,
          description: wn.items.appearance.description,
          badge: { label: wn.items.appearance.badge, variant: "default" },
        },
        {
          icon: <HeartPulse className="w-5 h-5 text-primary" />,
          title: wn.items.reliability.title,
          description: wn.items.reliability.description,
          badge: { label: wn.items.reliability.badge, variant: "secondary" },
        },
      ],
    },
  ];

  return (
    <AppShell title={t.whatsNew.title}>
      <Helmet>
        <title>{t.whatsNew.title}</title>
      </Helmet>

      <div className="max-w-2xl space-y-6 animate-fade-in">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{t.whatsNew.heading}</h1>
          <p className="text-sm text-muted-foreground">
            {t.whatsNew.description}
          </p>
        </div>

        {releases.map((release) => (
          <section key={release.version} className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-mono">
                v{release.version}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {release.date} · {wn.buildLabel}
              </span>
            </div>

            <div className="space-y-3">
              {release.highlights.map((item) => (
                <Card
                  key={item.title}
                  className="border-border/60 transition-colors hover:border-border"
                >
                  <CardHeader className="pb-1">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex-shrink-0">{item.icon}</div>
                      <div className="flex-1 min-w-0">
                        <CardTitle className="flex items-center gap-2 flex-wrap">
                          {item.title}
                          {item.badge && (
                            <Badge
                              variant={item.badge.variant}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {item.badge.label}
                            </Badge>
                          )}
                        </CardTitle>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="ps-12">
                    <CardDescription>{item.description}</CardDescription>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ))}

        <div className="pt-2">
          <Button className="w-full h-12" onClick={handleDismiss}>
            {t.whatsNew.gotIt}
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
