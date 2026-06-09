import { AppShell } from "@/components/layout/AppShell";
import { SettingsSectionHeader, SettingsToggle, SettingsSelect } from "@/components/settings-controls";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/hooks/use-auth";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorCard } from "@/components/ui/error-card";
import {
  Moon,
  Volume2,
  VolumeX,
  BellRing,
  Bell,
  BellOff,
  Clock,
  Calendar,
  RotateCcw,
  LogOut,
  Sun,
  AlignJustify,
  Send,
  ListChecks,
} from "lucide-react";
import { Link } from "wouter";
import { playFeedbackTone, playMuteTone } from "@/lib/sounds";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import type { ShiftRole, UserRole } from "@/types";
import { useEffect } from "react";
import { safeReloadPage } from "@/lib/safe-browser";

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const { name, email, signOut, effectiveRole, role, isLoaded, isSignedIn } = useAuth();
  const push = usePushNotifications();
  const roleContext = ((effectiveRole ?? role) as UserRole | ShiftRole | undefined) ?? "technician";
  const isSeniorContext = roleContext === "senior_technician";
  const isAdminContext = roleContext === "admin";
  const isTechnicianContext = !isSeniorContext && !isAdminContext;

  const syncRoleNotificationSettings = async (
    patch: Partial<{
      technicianReturnRemindersEnabled: boolean;
      seniorOwnReturnRemindersEnabled: boolean;
      seniorTeamOverdueAlertsEnabled: boolean;
      adminHourlySummaryEnabled: boolean;
    }>
  ) => {
    const effectivePatch = Object.fromEntries(
      Object.entries(patch).filter(([key, value]) => settings[key as keyof typeof settings] !== value)
    ) as typeof patch;

    if (Object.keys(effectivePatch).length === 0) return;

    update(effectivePatch);
    if (push.subscribed) {
      push.updateSettings(effectivePatch).catch(() => {
        toast.error("סנכרון הגדרות ההתראות נכשל");
      });
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  const handleSoundToggle = async (v: boolean) => {
    if (v) {
      await playFeedbackTone();
    } else {
      await playMuteTone();
    }
    update({ soundEnabled: v });
    if (push.subscribed) {
      push.updateSettings({ soundEnabled: v }).catch(() => {
        toast.error("סנכרון הגדרות ההתראות נכשל");
      });
    }
  };

  const handleCriticalAlertsToggle = async (v: boolean) => {
    if (settings.soundEnabled) {
      if (v) {
        await playFeedbackTone();
      } else {
        await playMuteTone();
      }
    }
    update({ criticalAlertsSound: v });
    if (push.subscribed) {
      push.updateSettings({ alertsEnabled: v }).catch(() => {
        toast.error("סנכרון הגדרות ההתראות נכשל");
      });
    }
  };

  const handleRoleNotificationToggle = async (
    key:
      | "technicianReturnRemindersEnabled"
      | "seniorOwnReturnRemindersEnabled"
      | "seniorTeamOverdueAlertsEnabled"
      | "adminHourlySummaryEnabled",
    value: boolean
  ) => {
    if (settings.soundEnabled) {
      if (value) {
        await playFeedbackTone();
      } else {
        await playMuteTone();
      }
    }
    await syncRoleNotificationSettings({ [key]: value });
  };

  useEffect(() => {
    if (isTechnicianContext) {
      void syncRoleNotificationSettings({
        seniorOwnReturnRemindersEnabled: false,
        seniorTeamOverdueAlertsEnabled: false,
        adminHourlySummaryEnabled: false,
      });
      return;
    }
    if (isSeniorContext) {
      void syncRoleNotificationSettings({
        technicianReturnRemindersEnabled: false,
        adminHourlySummaryEnabled: false,
      });
      return;
    }
    if (isAdminContext) {
      void syncRoleNotificationSettings({
        seniorOwnReturnRemindersEnabled: false,
        seniorTeamOverdueAlertsEnabled: false,
      });
    }
  }, [isTechnicianContext, isSeniorContext, isAdminContext]);

  if (!isLoaded) {
    const loadingContent = (
      <div className="w-full max-w-full overflow-x-hidden space-y-3 pb-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
    return <AppShell title={t.settingsPage.title}>{loadingContent}</AppShell>;
  }

  if (!isSignedIn) {
    const errorContent = (
      <div className="w-full max-w-full overflow-x-hidden space-y-3 pb-8">
        <ErrorCard
          message="לא ניתן לטעון הגדרות עבור הפעלה זו."
          onRetry={() => safeReloadPage()}
        />
      </div>
    );
    return <AppShell title={t.settingsPage.title}>{errorContent}</AppShell>;
  }

  const pageContent = (
    <>
      <div className="w-full max-w-full overflow-x-hidden space-y-6 pb-8 animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t.settingsPage.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.settingsPage.subtitle}</p>
        </div>

        {/* Display */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.display} />
          <div className="space-y-2">
            <SettingsSelect
              icon={<Sun className="w-5 h-5" />}
              label={t.settingsPage.colorTheme}
              description={t.settingsPage.colorThemeDescription}
              value={settings.colorTheme}
              options={[
                { value: "forest", label: t.settingsPage.colorThemeForest },
                { value: "clinical", label: t.settingsPage.colorThemeClinical },
                { value: "dark", label: t.settingsPage.colorThemeDark },
              ]}
              onValueChange={(v) => {
                const colorTheme = v as "forest" | "clinical" | "dark";
                update({
                  colorTheme,
                  ...(colorTheme === "dark" ? { darkMode: true } : {}),
                });
              }}
              data-testid="settings-color-theme"
            />
            <SettingsToggle
              icon={settings.darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              label={t.settingsPage.darkMode}
              description={t.settingsPage.darkModeDescription}
              checked={settings.darkMode}
              onCheckedChange={(v) => update({ darkMode: v })}
              data-testid="settings-dark-mode"
            />
            <SettingsToggle
              icon={<AlignJustify className="w-5 h-5" />}
              label={t.settingsPage.haptics}
              description={t.settingsPage.hapticsDescription}
              checked={settings.hapticsEnabled}
              onCheckedChange={(v) => update({ hapticsEnabled: v })}
              data-testid="settings-haptics"
            />
            <SettingsSelect
              icon={<AlignJustify className="w-5 h-5" />}
              label={t.settingsPage.displaySize}
              description={t.settingsPage.displaySizeDescription}
              value={settings.density}
              options={[
                { value: "comfortable", label: t.settingsPage.comfortable },
                { value: "compact", label: t.settingsPage.compact },
              ]}
              onValueChange={(v) => update({ density: v as "comfortable" | "compact" })}
              data-testid="settings-density"
            />
            <SettingsSelect
              icon={<AlignJustify className="w-5 h-5" />}
              label="שפה"
              description="בחר שפת ממשק וכיוון טקסט"
              value={settings.locale}
              options={[
                { value: "en", label: "אנגלית" },
                { value: "he", label: "עברית" },
              ]}
              onValueChange={(v) => update({ locale: v as "en" | "he" })}
              data-testid="settings-locale"
            />
          </div>
        </section>

        {/* Push Notifications */}
        {push.supported && (
          <section className="space-y-2">
            <SettingsSectionHeader label={t.settingsPage.pushNotifications} />
            <div className="space-y-2">
              <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-card border border-border/60">
                <span className="flex-shrink-0 text-muted-foreground">
                  {push.subscribed ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground leading-tight">{t.settingsPage.deviceNotifications}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {push.permission === "denied"
                      ? t.settingsPage.permissionDenied
                      : push.subscribed
                      ? t.settingsPage.subscribedDescription
                      : t.settingsPage.unsubscribedDescription}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-11 text-xs"
                  variant={push.subscribed ? "outline" : "default"}
                  disabled={push.loading}
                  data-testid="push-toggle-btn"
                  onClick={async () => {
                    if (push.subscribed) {
                      const ok = await push.unsubscribe();
                      if (ok) toast.success(t.settingsPage.pushDisabled);
                      else toast.error(push.error || t.settingsPage.pushDisableFailed);
                    } else {
                      const ok = await push.subscribe({
                        soundEnabled: settings.soundEnabled,
                        alertsEnabled: settings.criticalAlertsSound,
                        technicianReturnRemindersEnabled: settings.technicianReturnRemindersEnabled,
                        seniorOwnReturnRemindersEnabled: settings.seniorOwnReturnRemindersEnabled,
                        seniorTeamOverdueAlertsEnabled: settings.seniorTeamOverdueAlertsEnabled,
                        adminHourlySummaryEnabled: settings.adminHourlySummaryEnabled,
                      });
                      if (ok) toast.success(t.settingsPage.pushEnabled);
                      else if (push.permission === "denied") toast.error(t.settingsPage.deniedShort);
                      else toast.error(push.error || t.settingsPage.pushEnableFailed);
                    }
                  }}
                >
                  {push.subscribed ? t.settingsPage.disable : t.settingsPage.enable}
                </Button>
              </div>
              {push.subscribed && (
                <div className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-card border border-border/60">
                  <span className="flex-shrink-0 text-muted-foreground">
                    <Send className="w-5 h-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground leading-tight">{t.settingsPage.testNotifications}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.settingsPage.testNotificationsDescription}</p>
                  </div>
                  <Button
                    size="sm"
                    className="h-11 text-xs"
                    variant="outline"
                    disabled={push.loading}
                    data-testid="push-test-btn"
                    onClick={async () => {
                      const ok = await push.sendTestNotification();
                      if (ok) toast.success(t.settingsPage.testSent);
                      else toast.error(push.error || t.settingsPage.testFailed);
                    }}
                  >
                    שלח בדיקה
                  </Button>
                </div>
              )}

              {push.subscribed && (
                <div className="space-y-2">
                  <p className="px-1 text-xs font-semibold text-muted-foreground">
                    {t.settingsPage.roleNotificationPreferences}
                  </p>

                  {!isSeniorContext && (isTechnicianContext || isAdminContext) && (
                    <SettingsToggle
                      icon={<BellRing className="w-5 h-5" />}
                      label={t.settingsPage.techReturnReminders}
                      description={t.settingsPage.techReturnRemindersDescription}
                      checked={settings.technicianReturnRemindersEnabled}
                      onCheckedChange={(v) =>
                        handleRoleNotificationToggle(
                          "technicianReturnRemindersEnabled",
                          v
                        )
                      }
                      data-testid="settings-tech-return-reminders"
                    />
                  )}

                  {isSeniorContext && (
                    <>
                      <SettingsToggle
                        icon={<BellRing className="w-5 h-5" />}
                        label={t.settingsPage.seniorOwnReminders}
                        description={t.settingsPage.seniorOwnRemindersDescription}
                        checked={settings.seniorOwnReturnRemindersEnabled}
                        onCheckedChange={(v) =>
                          handleRoleNotificationToggle(
                            "seniorOwnReturnRemindersEnabled",
                            v
                          )
                        }
                        data-testid="settings-senior-own-reminders"
                      />
                      <SettingsToggle
                        icon={<Bell className="w-5 h-5" />}
                        label={t.settingsPage.seniorTeamAlerts}
                        description={t.settingsPage.seniorTeamAlertsDescription}
                        checked={settings.seniorTeamOverdueAlertsEnabled}
                        onCheckedChange={(v) =>
                          handleRoleNotificationToggle(
                            "seniorTeamOverdueAlertsEnabled",
                            v
                          )
                        }
                        data-testid="settings-senior-team-alerts"
                      />
                    </>
                  )}

                  {isAdminContext && (
                    <SettingsToggle
                      icon={<Clock className="w-5 h-5" />}
                      label={t.settingsPage.adminHourlySummary}
                      description={t.settingsPage.adminHourlySummaryDescription}
                      checked={settings.adminHourlySummaryEnabled}
                      onCheckedChange={(v) =>
                        handleRoleNotificationToggle(
                          "adminHourlySummaryEnabled",
                          v
                        )
                      }
                      data-testid="settings-admin-hourly-summary"
                    />
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Sound */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.sound} />
          <div className="space-y-2">
            <SettingsToggle
              icon={settings.soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              label={t.settingsPage.masterSound}
              description={t.settingsPage.masterSoundDescription}
              checked={settings.soundEnabled}
              onCheckedChange={handleSoundToggle}
              data-testid="settings-sound"
            />
            <SettingsToggle
              icon={<BellRing className="w-5 h-5" />}
              label={t.settingsPage.criticalAlerts}
              description={t.settingsPage.criticalAlertsDescription}
              checked={settings.criticalAlertsSound}
              onCheckedChange={handleCriticalAlertsToggle}
              data-testid="settings-critical-sound"
            />
          </div>
        </section>

        {/* Date & Time */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.dateAndTime} />
          <div className="space-y-2">
            <SettingsSelect
              icon={<Clock className="w-5 h-5" />}
              label={t.settingsPage.timeFormat}
              description={t.settingsPage.timeFormatDescription}
              value={settings.timeFormat}
              options={[
                { value: "12h", label: "12 שעות (AM/PM)" },
                { value: "24h", label: "24 שעות" },
              ]}
              onValueChange={(v) => update({ timeFormat: v as "12h" | "24h" })}
              data-testid="settings-time-format"
            />
            <SettingsSelect
              icon={<Calendar className="w-5 h-5" />}
              label={t.settingsPage.dateFormat}
              description={t.settingsPage.dateFormatDescription}
              value={settings.dateFormat}
              options={[
                { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
                { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
                { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
              ]}
              onValueChange={(v) => update({ dateFormat: v as "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" })}
              data-testid="settings-date-format"
            />
          </div>
        </section>

        {/* Reset */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.reset} />
          <div className="rounded-xl bg-card border border-border/60 px-4 py-4">
            <p className="text-sm text-foreground font-medium mb-1">{t.settingsPage.resetToDefault}</p>
            <p className="text-xs text-muted-foreground mb-3">
              {t.settingsPage.resetDescription}
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 border-border/60 h-11 text-xs" data-testid="settings-reset-btn">
                  <RotateCcw className="w-4 h-4" />
                  {t.settingsPage.resetButton}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.settingsPage.resetDialogTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.settingsPage.resetDescription}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={reset}
                    className="bg-destructive hover:bg-destructive/90"
                    data-testid="settings-reset-confirm"
                  >
                    {t.settingsPage.resetButton}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>

        {/* Account */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.account} />
          <div className="rounded-xl bg-card border border-border/60 px-4 py-4 space-y-3">
            {(name || email) && (
              <div>
                {name && <p className="text-sm font-medium text-foreground">{name}</p>}
                {email && <p className="text-xs text-muted-foreground">{email}</p>}
              </div>
            )}
            <Button
              variant="outline"
              className="gap-2 w-full sm:w-auto border-border/60 text-muted-foreground hover:text-foreground"
              onClick={handleLogout}
              data-testid="settings-logout"
            >
              <LogOut className="w-4 h-4" />
              {t.settingsPage.logout}
            </Button>
          </div>
        </section>

        {isAdminContext && (
          <section className="space-y-2">
            <SettingsSectionHeader label={t.settingsPage.crashCartChecklist} />
            <div className="rounded-xl bg-card border border-border/60 px-4 py-4 space-y-3">
              <p className="text-sm text-muted-foreground">{t.settingsPage.crashCartChecklistDescription}</p>
              <Link href="/crash-cart?configure=1">
                <Button variant="outline" size="sm" className="gap-2" data-testid="settings-crash-cart-checklist">
                  <ListChecks className="w-4 h-4" aria-hidden />
                  {t.settingsPage.crashCartChecklistManage}
                </Button>
              </Link>
            </div>
          </section>
        )}

        {/* About */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.about} />
          <div className="rounded-xl bg-card border border-border/60 px-4 py-4 space-y-1">
            <p className="text-sm font-medium text-foreground">VetTrack</p>
            <p className="text-xs text-muted-foreground">
              Version <span data-testid="app-version">{__APP_VERSION__}</span>
            </p>
            <a
              href="/whats-new"
              className="text-xs text-primary underline-offset-2 hover:underline"
              data-testid="changelog-link"
            >
              See what&apos;s new
            </a>
          </div>
        </section>
      </div>
    </>
  );
  return <AppShell title={t.settingsPage.title}>{pageContent}</AppShell>;
}
