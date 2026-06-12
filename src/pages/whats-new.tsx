import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Bell,
  Shield,
  Stethoscope,
  Siren,
  Users,
  Clock,
  Smartphone,
  RefreshCw,
  ArrowLeft,
  Scan,
  MapPin,
  ShieldCheck,
  HeartPulse,
} from "lucide-react";

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
  // Built inside the component so it re-renders in the active locale. Only the
  // current release is shown — older, outdated entries were removed.
  const wn = t.whatsNew;
  const releases: ReleaseEntry[] = [
    {
      version: wn.currentVersion,
      date: wn.currentDate,
      highlights: [
        {
          icon: <Smartphone className="w-5 h-5 text-primary" />,
          title: wn.items.nativeApp.title,
          description: wn.items.nativeApp.description,
          badge: { label: wn.items.nativeApp.badge, variant: "default" },
        },
        {
          icon: <ShieldCheck className="w-5 h-5 text-primary" />,
          title: wn.items.signIn.title,
          description: wn.items.signIn.description,
          badge: { label: wn.items.signIn.badge, variant: "default" },
        },
        {
          icon: <Stethoscope className="w-5 h-5 text-primary" />,
          title: wn.items.theme.title,
          description: wn.items.theme.description,
          badge: { label: wn.items.theme.badge, variant: "secondary" },
        },
        {
          icon: <MapPin className="w-5 h-5 text-primary" />,
          title: wn.items.navigation.title,
          description: wn.items.navigation.description,
          badge: { label: wn.items.navigation.badge, variant: "secondary" },
        },
      ],
    },
  ];

  return (
    <Layout>
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
                {release.date}
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

        <div className="pt-2 pb-4">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline underline-offset-2"
          >
            {t.whatsNew.configureAlerts}
            <ArrowLeft className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </Layout>
  );
}
