import { ProfileHeroZone } from "@/features/profile/ProfileHeroZone";
import { ShiftActivityList } from "@/features/profile/ShiftActivityList";
import { t } from "@/lib/i18n";
import { isCapacitorNative } from "@/lib/capacitor-runtime";
import { useLocation } from "wouter";
import { BackChevron } from "@/components/ui/directional-chevron";

export default function MyProfilePage() {
  const [, navigate] = useLocation();
  const native = isCapacitorNative();

  return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "hsl(var(--background))" }}>
        {/* Header — only on native (web uses desktop shell nav) */}
        {native && (
          <div style={{
            display: "flex",
            alignItems: "center",
            paddingInline: 8,
            paddingTop: "calc(env(safe-area-inset-top) + 8px)",
            paddingBottom: 8,
            borderBottom: "0.5px solid hsl(var(--border))",
            background: "hsl(var(--background) / 0.94)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            flexShrink: 0,
          }}>
            <button
              type="button"
              onClick={() => navigate(-1 as unknown as string)}
              aria-label="Back"
              style={{
                width: 36,
                height: 36,
                border: "none",
                background: "transparent",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <BackChevron className="w-5 h-5" aria-hidden />
            </button>
            <span style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 17,
              fontWeight: 600,
              color: "hsl(var(--foreground))",
            }}>
              {t.profile.title}
            </span>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: "env(safe-area-inset-bottom)" }}>
          <ProfileHeroZone />
          <div style={{ height: "0.5px", background: "hsl(var(--border))", marginInline: 0 }} />
          <ShiftActivityList />
        </div>
      </div>
  );
}
