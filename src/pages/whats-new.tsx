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

const releases: ReleaseEntry[] = [
  {
    version: "1.1.2",
    date: "May 2026",
    highlights: [
      {
        icon: <RefreshCw className="w-5 h-5 text-primary" />,
        title: "What's New navigation & equipment links",
        description:
          "The \"See what's new\" link from Settings, the update banner, and the menu now work correctly in pilot mode. Invalid paths such as /equipment/scan now redirect to the equipment list instead of showing a page not found screen.",
        badge: { label: "Fix", variant: "outline" },
      },
      {
        icon: <Scan className="w-5 h-5 text-primary" />,
        title: "Clearer scan button on mobile",
        description:
          "Removed the duplicate scan button on the home and pilot screens on mobile — only the central scan button at the bottom remains. The desktop shortcut is still available.",
        badge: { label: "Fix", variant: "outline" },
      },
      {
        icon: <ShieldCheck className="w-5 h-5 text-primary" />,
        title: "Equipment confirmation in Room Radar",
        description:
          "Tapping \"Confirm here\" now correctly updates the verification status and shows a precise server error message instead of the generic \"Unable to confirm\". Item counts per room (e.g. ICU) match server data.",
        badge: { label: "Fix", variant: "outline" },
      },
      {
        icon: <MapPin className="w-5 h-5 text-primary" />,
        title: "Room Radar and maintenance filter",
        description:
          "The \"Maintenance\" link in the desktop equipment sidebar now filters the list to items under maintenance. Navigation from a room to an equipment item always opens the correct detail page.",
      },
      {
        icon: <HeartPulse className="w-5 h-5 text-primary" />,
        title: "Crash cart list per hospital",
        description:
          "Admins can customise the daily check list items for the crash cart per ward: add, edit, and remove items from the cart check screen or from Settings. The list persists across all shifts at that hospital.",
        badge: { label: "New", variant: "default" },
      },
    ],
  },
  {
    version: "1.1.1",
    date: "April 2026",
    highlights: [
      {
        icon: <Stethoscope className="w-5 h-5 text-primary" />,
        title: "Active patients",
        description:
          "Admit patients directly from the app. Track hospitalisation status (admitted, critical, observation, recovery), ward location and bed, admitting vet, and reason for stay. The KPI counter on the home screen now shows a live hospitalised patient count.",
        badge: { label: "New", variant: "default" },
      },
      {
        icon: <Siren className="w-5 h-5 text-red-500" />,
        title: "Code Blue — Emergency command centre",
        description:
          "Redesigned Code Blue as a full emergency command centre: resuscitation timer, CPR task checklist with timestamps, quick event log for real-time documentation, and a full audit trail saved after the incident ends.",
        badge: { label: "Redesigned", variant: "secondary" },
      },
    ],
  },
  {
    version: "1.1.0",
    date: "April 2026",
    highlights: [
      {
        icon: <Bell className="w-5 h-5 text-primary" />,
        title: "Smart alerts",
        description:
          "Push notifications for return reminders, overdue alerts for staff (senior technicians), and hourly summaries for managers — all configurable by role in Settings.",
        badge: { label: "New", variant: "default" },
      },
      {
        icon: <Shield className="w-5 h-5 text-primary" />,
        title: "Shift-aware roles",
        description:
          "Your effective role now tracks the active shift. Permissions, alerts, and dashboard context update automatically when you are on shift.",
        badge: { label: "New", variant: "default" },
      },
      {
        icon: <Smartphone className="w-5 h-5 text-primary" />,
        title: "Browser push notifications",
        description:
          "Subscribe to push notifications directly from the browser. Granular toggles let you control which alerts you receive — return reminders, staff updates, or admin summaries.",
        badge: { label: "New", variant: "default" },
      },
      {
        icon: <Clock className="w-5 h-5 text-primary" />,
        title: "Scheduled return reminders",
        description:
          "When equipment leaves with a scheduled return time, the system sends an automatic push reminder when the time is due. Reminders are cancelled if the item is returned early.",
      },
      {
        icon: <Users className="w-5 h-5 text-primary" />,
        title: "User management for admins",
        description:
          "A user list with pagination and filters for pending, active, and blocked accounts. Approve or reject registrations, change roles, and manage user status — all from the admin panel.",
      },
      {
        icon: <RefreshCw className="w-5 h-5 text-primary" />,
        title: "Automatic update banner",
        description:
          "A banner appears when a new version of VetTrack is deployed, with a direct link to this page. Service worker updates offer a one-click refresh.",
      },
    ],
  },
];

export default function WhatsNewPage() {
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
