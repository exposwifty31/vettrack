import { Link } from "wouter";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { Home, Frown } from "lucide-react";
import { t } from "@/lib/i18n";

export default function NotFoundPage() {
  return (
    <AppShell>
      <Helmet>
        <title>{t.notFoundPage.title}</title>
        <meta name="description" content="The page you are looking for does not exist. Return to the VetTrack dashboard." />
      </Helmet>
      <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
        <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
          <Frown className="w-10 h-10 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-bold">הדף לא נמצא</h1>
        <p className="text-muted-foreground">הדף שחיפשת אינו קיים.</p>
        <Link href="/home">
          <Button data-testid="btn-go-home">
            <Home className="w-4 h-4 ms-2" />
            לדף הבית
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
