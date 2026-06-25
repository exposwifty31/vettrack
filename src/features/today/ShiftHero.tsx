import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { t } from "@/lib/i18n";

type Props = {
  shift: { startedAt: string } | null;
  itemsOut: number;
  scansToday: number;
  isLoading: boolean;
};

function useElapsedClock(startedAt: string | undefined): string {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    if (!startedAt) return;
    function tick() {
      const ms = Date.now() - new Date(startedAt!).getTime();
      const totalMin = Math.max(0, Math.floor(ms / 60_000));
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      setDisplay(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return display;
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span
        style={{
          fontFamily: "var(--font-num)",
          fontSize: "var(--text-xl)",
          fontWeight: 700,
          color: "#fff",
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: "var(--text-2xs)", color: "rgba(255,255,255,0.6)", fontWeight: 500 }}>
        {label}
      </span>
    </div>
  );
}

export function ShiftHero({ shift, itemsOut, scansToday, isLoading }: Props) {
  const [, navigate] = useLocation();
  const elapsed = useElapsedClock(shift?.startedAt);

  if (isLoading) {
    return (
      <div
        style={{
          borderRadius: 20,
          background: "var(--brand-ink)",
          padding: "20px 20px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ height: 14, width: "40%", borderRadius: 8, background: "rgba(255,255,255,0.12)" }} />
        <div style={{ height: 36, width: "55%", borderRadius: 8, background: "rgba(255,255,255,0.10)" }} />
        <div style={{ display: "flex", gap: 32 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ height: 32, width: 60, borderRadius: 8, background: "rgba(255,255,255,0.08)" }} />
          ))}
        </div>
        <div style={{ height: 44, borderRadius: 12, background: "rgba(255,255,255,0.10)" }} />
      </div>
    );
  }

  if (!shift) {
    return (
      <div
        style={{
          borderRadius: 20,
          background: "var(--brand-ink)",
          padding: "20px 20px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p style={{ fontSize: "var(--text-sm)", color: "rgba(255,255,255,0.5)", margin: 0 }}>
          {t.home.shift.noShift}
        </p>
        <button
          type="button"
          onClick={() => navigate("/handoff")}
          style={{
            minHeight: 44,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.08)",
            color: "#fff",
            fontSize: "var(--text-sm)",
            fontWeight: 600,
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {t.home.shift.startShift}
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 20,
        background: "var(--brand-ink)",
        padding: "20px 20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <p style={{ fontSize: "var(--text-2xs)", fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.5)", margin: 0, textTransform: "uppercase" }}>
        {t.home.shift.elapsed}
      </p>

      <span
        style={{
          fontFamily: "var(--font-num)",
          fontSize: "var(--text-3xl)",
          fontWeight: 700,
          color: "#fff",
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        {elapsed}
      </span>

      <div style={{ display: "flex", gap: 32 }}>
        <StatPill label={t.home.shift.itemsOut} value={itemsOut} />
        <StatPill label={t.home.shift.scansToday} value={scansToday} />
      </div>

      <button
        type="button"
        onClick={() => navigate("/handoff")}
        style={{
          minHeight: 44,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(255,255,255,0.08)",
          color: "#fff",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
          transition: "background 150ms ease",
        }}
        onPointerDown={(e) => ((e.currentTarget.style.background = "rgba(255,255,255,0.14)"))}
        onPointerUp={(e) => ((e.currentTarget.style.background = "rgba(255,255,255,0.08)"))}
        onPointerLeave={(e) => ((e.currentTarget.style.background = "rgba(255,255,255,0.08)"))}
      >
        {t.home.shift.endShift}
      </button>
    </div>
  );
}
