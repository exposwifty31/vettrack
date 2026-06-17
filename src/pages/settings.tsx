import { AppShell } from "@/components/layout/AppShell";
import { ShiftSummarySheet } from "@/components/shift-summary-sheet";
import { DeleteAccountDialog } from "@/components/delete-account-dialog";
import { SettingsSectionHeader, SettingsToggle, SettingsSelect } from "@/components/settings-controls";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/hooks/use-auth";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useConfirm } from "@/hooks/use-confirm";
import { withToast } from "@/lib/toast-result";
import { Button } from "@/components/ui/button";
import { Bdi } from "@/components/ui/bdi";
import { maskEmail } from "@/lib/mask-email";
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
  CalendarClock,
  RotateCcw,
  LogOut,
  Sun,
  Palette,
  Vibrate,
  LayoutGrid,
  Languages,
  PackageCheck,
  Users,
  AlertTriangle,
  Send,
  ListChecks,
  ClipboardCheck,
  Trash2,
} from "lucide-react";
import { Link } from "wouter";
import { playFeedbackTone, playMuteTone } from "@/lib/sounds";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import type { ShiftRole, UserRole } from "@/types";
import { useEffect, useState } from "react";
import { safeReloadPage } from "@/lib/safe-browser";

export default function SettingsPage() {
  const confirm = useConfirm();
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [emailRevealed, setEmailRevealed] = useState(false);
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
        toast.error(t.settingsPage.pushSyncFailed);
      });
    }
  };

  const handleLogout = async () => {
    if (
      !(await confirm({
        title: t.settingsPage.logoutConfirmTitle,
        description: t.settingsPage.logoutConfirmDescription,
        confirmLabel: t.settingsPage.logout,
        destructive: true,
      }))
    ) {
      return;
    }
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
        toast.error(t.settingsPage.pushSyncFailed);
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
        toast.error(t.settingsPage.pushSyncFailed);
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
          message={t.settingsPage.loadFailedForSession}
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
          <h1 className="vt-page-title text-foreground">{t.settingsPage.title}</h1>
          <p className="vt-text-sm text-muted-foreground mt-1">{t.settingsPage.subtitle}</p>
        </div>

        {/* Display */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.display} />
          <div className="space-y-2">
            <SettingsSelect
              icon={<Palette className="w-5 h-5" />}
              label={t.settingsPage.colorTheme}
              description={t.settingsPage.colorThemeDescription}
              value={settings.colorTheme}
              options={[
                { value: "forest", label: t.settingsPage.colorThemeForest },
                { value: "clinical", label: t.settingsPage.colorThemeClinical },
              ]}
              onValueChange={(v) => {
                const colorTheme = v as "forest" | "clinical";
                update({ colorTheme });
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
              icon={<Vibrate className="w-5 h-5" />}
              label={t.settingsPage.haptics}
              checked={settings.hapticsEnabled}
              onCheckedChange={(v) => update({ hapticsEnabled: v })}
              data-testid="settings-haptics"
            />
            <SettingsSelect
              icon={<LayoutGrid className="w-5 h-5" />}
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
              icon={<Languages className="w-5 h-5" />}
              lang="he"
              label={t.settingsPage.language}
              description={t.settingsPage.languageDescription}
              value={settings.locale}
              options={[
                { value: "en", label: t.settingsPage.languageEn },
                { value: "he", label: t.settingsPage.languageHe },
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
                    {t.settingsPage.sendTest}
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
                      icon={<PackageCheck className="w-5 h-5" />}
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
                        icon={<ClipboardCheck className="w-5 h-5" />}
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
                        icon={<Users className="w-5 h-5" />}
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
                      icon={<CalendarClock className="w-5 h-5" />}
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
              icon={<AlertTriangle className="w-5 h-5" />}
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
                { value: "12h", label: t.settingsPage.timeFormat12h },
                { value: "24h", label: t.settingsPage.timeFormat24h },
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
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-border/60 h-11 text-xs"
              data-testid="settings-reset-btn"
              onClick={async () => {
                if (
                  !(await confirm({
                    title: t.settingsPage.resetDialogTitle,
                    description: t.settingsPage.resetDescription,
                    confirmLabel: t.settingsPage.resetButton,
                    destructive: true,
                  }))
                ) {
                  return;
                }
                await withToast(
                  async () => {
                    reset();
                  },
                  { success: t.settingsPage.resetSuccess },
                );
              }}
            >
              <RotateCcw className="w-4 h-4" />
              {t.settingsPage.resetButton}
            </Button>
          </div>
        </section>

        {/* Account */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.account} />
          <div className="rounded-xl bg-card border border-border/60 px-4 py-4 space-y-3">
            {(name || email) && (
              <div>
                {name && <p className="text-sm font-medium text-foreground">{name}</p>}
                {email && (
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <p className="text-xs text-muted-foreground">
                      <Bdi dir="ltr">{emailRevealed ? email : maskEmail(email)}</Bdi>
                    </p>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs text-muted-foreground"
                      onClick={() => setEmailRevealed((v) => !v)}
                      data-testid="settings-email-reveal"
                    >
                      {emailRevealed ? t.settingsPage.hideEmail : t.settingsPage.showEmail}
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2 border-border/60 text-muted-foreground hover:text-foreground"
                onClick={() => setShiftSummaryOpen(true)}
                data-testid="settings-shift-summary"
              >
                <ClipboardCheck className="w-4 h-4" />
                {t.myEquipmentPage.shiftSummary}
              </Button>
              <Button
                variant="outline"
                className="gap-2 border-border/60 text-muted-foreground hover:text-foreground h-11"
                onClick={handleLogout}
                data-testid="settings-logout"
              >
                <LogOut className="w-4 h-4" />
                {t.settingsPage.logout}
              </Button>
            </div>
          </div>
        </section>

        <ShiftSummarySheet open={shiftSummaryOpen} onClose={() => setShiftSummaryOpen(false)} />

        {/* Danger Zone — in-app account deletion (App Store Guideline 5.1.1(v)) */}
        <section className="space-y-2">
          <SettingsSectionHeader label={t.settingsPage.dangerZone} />
          <div className="rounded-xl bg-card border border-destructive/40 px-4 py-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t.settingsPage.deleteAccount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t.settingsPage.deleteAccountDescription}</p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="gap-2 h-11 text-xs"
              onClick={() => setDeleteAccountOpen(true)}
              data-testid="settings-delete-account"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
              {t.settingsPage.deleteAccount}
            </Button>
          </div>
        </section>

        <DeleteAccountDialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen} />

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
              {t.settingsPage.versionLabel} <span data-testid="app-version">{__APP_VERSION__}</span>
            </p>
            <a
              href="/whats-new"
              className="text-xs text-primary underline-offset-2 hover:underline"
              data-testid="changelog-link"
            >
              {t.settingsPage.seeWhatsNew}
            </a>
          </div>
        </section>
      </div>
    </>
  );
  return <AppShell title={t.settingsPage.title}>{pageContent}</AppShell>;
}
