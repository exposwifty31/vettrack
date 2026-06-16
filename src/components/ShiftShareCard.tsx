import { forwardRef } from "react";
import { t, getStoredLocale } from "@/lib/i18n";

// Fixed-size card rendered off-screen and captured with html-to-image.
// MUST use only inline styles — Tailwind classes are not applied during capture.
const BRAND = "#1a3d28";      // forest green
const BRAND_LIGHT = "#2d6647"; // lighter green for accent
const IVORY = "#f3f1eb";      // warm off-white
const IVORY_BORDER = "#e2dfd7";
const TEXT = "#1c1917";
const TEXT2 = "#6b6560";

export interface ShiftShareCardData {
  name: string;
  date: string;
  tasksDone: number;
  tasksTotal: number;
  scansToday: number;
  streak: number;
  heroPct: number | null;
}

interface Props {
  data: ShiftShareCardData;
}

export const ShiftShareCard = forwardRef<HTMLDivElement, Props>(({ data }, ref) => {
  const { name, date, tasksDone, tasksTotal, scansToday, streak, heroPct } = data;

  const progressWidth = heroPct !== null ? `${heroPct}%` : "0%";
  const isRtl = getStoredLocale() === "he";

  return (
    <div
      ref={ref}
      dir={isRtl ? "rtl" : "ltr"}
      style={{
        width: 390,
        height: 560,
        background: IVORY,
        borderRadius: 24,
        overflow: "hidden",
        fontFamily: "'DM Sans', system-ui, sans-serif",
        direction: isRtl ? "rtl" : "ltr",
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        left: -9999,
        top: -9999,
        boxShadow: "0 4px 32px rgba(0,0,0,0.12)",
      }}
    >
      {/* Header stripe */}
      <div
        style={{
          background: BRAND,
          padding: "28px 28px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              color: "#fff",
              fontWeight: 700,
            }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.shiftShareCard.title}</div>
            <div style={{ color: "#fff", fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{name}</div>
          </div>
          <div style={{ marginInlineStart: "auto" }} />
          <div
            style={{
              background: "rgba(255,255,255,0.15)",
              borderRadius: 8,
              padding: "4px 10px",
              color: "rgba(255,255,255,0.85)",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {date}
          </div>
        </div>
      </div>

      {/* Hero metric */}
      {heroPct !== null && (
        <div style={{ padding: "24px 28px 0" }}>
          <div style={{ marginBottom: 8, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 48, fontWeight: 800, color: BRAND, lineHeight: 1 }}>{heroPct}%</span>
            <span style={{ fontSize: 14, color: TEXT2, fontWeight: 500 }}>{t.shiftShareCard.heroTasksDone}</span>
          </div>
          <div style={{ height: 6, background: IVORY_BORDER, borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: progressWidth, background: BRAND_LIGHT, borderRadius: 99, transition: "width 0.4s ease" }} />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: TEXT2 }}>
            {t.shiftShareCard.tasksCompletedOf(tasksDone, tasksTotal)}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div style={{ padding: "20px 28px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, flex: 1 }}>
        {/* Scans today */}
        <div
          style={{
            background: "#fff",
            border: `1px solid ${IVORY_BORDER}`,
            borderRadius: 16,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 11, color: TEXT2, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{t.shiftShareCard.scansToday}</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: TEXT, lineHeight: 1 }}>{scansToday}</div>
          <div style={{ fontSize: 11, color: TEXT2 }}>{t.shiftShareCard.equipmentScans}</div>
        </div>

        {/* Streak */}
        <div
          style={{
            background: streak > 0 ? BRAND : "#fff",
            border: `1px solid ${streak > 0 ? BRAND : IVORY_BORDER}`,
            borderRadius: 16,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 11, color: streak > 0 ? "rgba(255,255,255,0.7)" : TEXT2, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{t.shiftShareCard.streak}</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: streak > 0 ? "#fff" : TEXT, lineHeight: 1 }}>
            {streak > 0 ? `${streak}🔥` : "–"}
          </div>
          <div style={{ fontSize: 11, color: streak > 0 ? "rgba(255,255,255,0.7)" : TEXT2 }}>
            {streak > 0 ? t.shiftShareCard.daysInRow : t.shiftShareCard.startStreak}
          </div>
        </div>

        {/* Tasks done */}
        <div
          style={{
            gridColumn: "1 / -1",
            background: "#fff",
            border: `1px solid ${IVORY_BORDER}`,
            borderRadius: 16,
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: TEXT2, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{t.shiftShareCard.tasksCompleted}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: TEXT, marginTop: 2 }}>{tasksDone} / {tasksTotal}</div>
          </div>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: tasksTotal > 0 && tasksDone === tasksTotal ? BRAND : IVORY_BORDER,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            {tasksTotal > 0 && tasksDone === tasksTotal ? "✓" : "…"}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: "16px 28px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: TEXT2, fontWeight: 500 }}>{t.shiftShareCard.footer}</div>
        <div style={{ fontSize: 11, color: TEXT2 }}>vettrack.uk</div>
      </div>
    </div>
  );
});

ShiftShareCard.displayName = "ShiftShareCard";
