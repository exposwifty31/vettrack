import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
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
    date: "מאי 2026",
    highlights: [
      {
        icon: <RefreshCw className="w-5 h-5 text-primary" />,
        title: "מה חדש וניווט ציוד",
        description:
          "קישור «ראה מה חדש» מהגדרות, מבאנר העדכון ומהתפריט עובד גם במצב פיילוט. נתיבים שגויים כמו /equipment/scan מפנים כעת לרשימת הציוד במקום מסך «הדף לא נמצא».",
        badge: { label: "תיקון", variant: "outline" },
      },
      {
        icon: <Scan className="w-5 h-5 text-primary" />,
        title: "סריקה ברורה במובייל",
        description:
          "במסך הבית ובפיילוט הוסר כפתור סריקה כפול — במובייל נשאר רק כפתור הסריקה המרכזי בתחתית. בדסקטופ עדיין זמין קיצור דרך לסריקה.",
        badge: { label: "תיקון", variant: "outline" },
      },
      {
        icon: <ShieldCheck className="w-5 h-5 text-primary" />,
        title: "אישור ציוד ברדאר חדרים",
        description:
          "לחיצה על «אשר כאן» מעדכנת כעת את מצב האימות (lastVerified) ומציגה הודעת שגיאה מדויקת מהשרת במקום «לא ניתן לאשר» גנרי. ספירת פריטים בחדר (למשל ICU) תואמת לנתוני השרת.",
        badge: { label: "תיקון", variant: "outline" },
      },
      {
        icon: <MapPin className="w-5 h-5 text-primary" />,
        title: "רדאר חדרים ותחזוקה",
        description:
          "קישור «תחזוקה» בסרגל הציוד בדסקטופ מסנן את הרשימה לפריטים בתחזוקה. ניווט מחדר לפריט ציוד נפתח תמיד לעמוד הפרטים הנכון.",
      },
      {
        icon: <HeartPulse className="w-5 h-5 text-primary" />,
        title: "רשימת עגלת החייאה לפי בית החולים",
        description:
          "מנהל יכול להתאים את פריטי הבדיקה היומית לעגלה במחלקה: הוספה, עריכה והסרה ממסך בדיקת העגלה או מהגדרות. הרשימה נשמרת לכל המשמרות באותו בית חולים.",
        badge: { label: "חדש", variant: "default" },
      },
    ],
  },
  {
    version: "1.1.1",
    date: "אפריל 2026",
    highlights: [
      {
        icon: <Stethoscope className="w-5 h-5 text-primary" />,
        title: "מטופלים פעילים",
        description:
          "קבלת מטופלים ישירות מהאפליקציה. מעקב אחר סטטוס אשפוז (קבלה, קריטי, תצפית, שיקום), מיקום מחלקה ומיטה, הווטרינר הקולט וסיבת האשפוז. מד ה-KPI במסך הבית מציג כעת ספירת מטופלים מאושפזים אמיתית.",
        badge: { label: "חדש", variant: "default" },
      },
      {
        icon: <Siren className="w-5 h-5 text-red-500" />,
        title: "קוד כחול — מרכז פיקוד חירום",
        description:
          "עיצוב מחדש של קוד כחול כמרכז פיקוד חירום מלא: טיימר החייאה, רשימת משימות CPR עם חותמות זמן, יומן אירועים מהיר לתיעוד בזמן אמת, ונתיב ביקורת מלא שנשמר גם לאחר סיום האירוע.",
        badge: { label: "עוצב מחדש", variant: "secondary" },
      },
    ],
  },
  {
    version: "1.1.0",
    date: "אפריל 2026",
    highlights: [
      {
        icon: <Bell className="w-5 h-5 text-primary" />,
        title: "התראות חכמות",
        description:
          "התראות Push לתזכורות החזרה, התראות על איחורים לצוות (טכנאים בכירים), וסיכומים שעתיים למנהלים — הכל ניתן להגדרה לפי תפקיד בהגדרות.",
        badge: { label: "חדש", variant: "default" },
      },
      {
        icon: <Shield className="w-5 h-5 text-primary" />,
        title: "תפקידים מודעי-משמרת",
        description:
          "התפקיד האפקטיבי שלך עוקב כעת אחרי המשמרת הפעילה. הרשאות, התראות והקשר לוח הבקרה מתעדכנים אוטומטית כשאתה במשמרת.",
        badge: { label: "חדש", variant: "default" },
      },
      {
        icon: <Smartphone className="w-5 h-5 text-primary" />,
        title: "התראות Push בדפדפן",
        description:
          "הרשם להתראות Push ישירות מהדפדפן. מתגים גרעיניים מאפשרים לך לשלוט אילו התראות לקבל — תזכורות החזרה, עדכוני צוות, או סיכומים מנהליים.",
        badge: { label: "חדש", variant: "default" },
      },
      {
        icon: <Clock className="w-5 h-5 text-primary" />,
        title: "תזכורות החזרה מתוזמנות",
        description:
          "כשציוד יוצא לשימוש עם זמן החזרה, המערכת שולחת תזכורת Push אוטומטית כשמגיע המועד. התזכורות מבוטלות אם הפריט הוחזר מוקדם יותר.",
      },
      {
        icon: <Users className="w-5 h-5 text-primary" />,
        title: "ניהול משתמשים למנהלים",
        description:
          "רשימת משתמשים עם עמודים ומסננים לממתינים, פעילים וחסומים. אישור או דחיית הרשמות, שינוי תפקידים וניהול סטטוס משתמש — הכל מלוח הניהול.",
      },
      {
        icon: <RefreshCw className="w-5 h-5 text-primary" />,
        title: "באנר עדכון אוטומטי",
        description:
          "באנר מופיע כשגרסת VetTrack חדשה מוצבת, עם קישור ישיר לדף זה. עדכוני Service Worker מציעים רענון בלחיצה אחת.",
      },
    ],
  },
];

export default function WhatsNewPage() {
  return (
    <Layout>
      <Helmet>
        <title>מה חדש — VetTrack</title>
      </Helmet>

      <div className="max-w-2xl space-y-6 animate-fade-in">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">מה חדש</h1>
          <p className="text-sm text-muted-foreground">
            הפיצ׳רים והשיפורים האחרונים של VetTrack.
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
            הגדר התראות בהגדרות
            <ArrowLeft className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </Layout>
  );
}
