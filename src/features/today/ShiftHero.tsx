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
    const at = startedAt;
    function tick() {
      const ms = Date.now() - new Date(at).getTime();
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
          fontWeight: 600,
          color: "var(--on-ink)",
          lineHeight: 1,
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: "var(--text-2xs)", color: "var(--on-ink-muted)", fontWeight: 500 }}>
        {label}
      </span>
    </div>
  );
}

const heroBase: React.CSSProperties = {
  borderRadius: 16,
  background: "var(--brand-ink)",
  padding: "16px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  boxShadow: "var(--shadow-hero)",
};

export function ShiftHero({ shift, itemsOut, scansToday, isLoading }: Props) {
  const [, navigate] = useLocation();
  const elapsed = useElapsedClock(shift?.startedAt);

  if (isLoading) {
    return (
      <div style={heroBase}>
        <div style={{ height: 14, width: "40%", borderRadius: 8, background: "var(--ink-skeleton)" }} />
        <div style={{ height: 36, width: "55%", borderRadius: 8, background: "var(--ink-sheen)" }} />
        <div style={{ display: "flex", gap: 32 }}>
          {[0, 1].map((i) => (
            <div key={i} style={{ height: 32, width: 60, borderRadius: 8, background: "var(--ink-fill-weak)" }} />
          ))}
        </div>
        <div style={{ height: 44, borderRadius: 12, background: "var(--ink-sheen)" }} />
      </div>
    );
  }

  if (!shift) {
    return (
      <div style={heroBase}>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--on-ink-muted)", margin: 0 }}>
          {t.home.shift.noShift}
        </p>
        <button
          type="button"
          onClick={() => navigate("/handoff")}
          style={{
            minHeight: 44,
            borderRadius: 12,
            border: "1px solid var(--ink-border)",
            background: "var(--ink-fill-weak)",
            color: "var(--on-ink)",
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
    <div style={heroBase}>
      <p style={{ fontSize: "var(--text-2xs)", fontWeight: 600, letterSpacing: "0.12em", color: "var(--on-ink-muted)", margin: 0, textTransform: "uppercase" }}>
        {t.home.shift.elapsed}
      </p>

      <span
        style={{
          fontFamily: "var(--font-num)",
          fontSize: "34px",
          fontWeight: 600,
          color: "var(--on-ink)",
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
          border: "1px solid var(--ink-border)",
          background: "var(--ink-fill-weak)",
          color: "var(--on-ink)",
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
          transition: "background 150ms ease",
        }}
        onPointerDown={(e) => { e.currentTarget.style.background = "var(--ink-fill)"; }}
        onPointerUp={(e) => { e.currentTarget.style.background = "var(--ink-fill-weak)"; }}
        onPointerLeave={(e) => { e.currentTarget.style.background = "var(--ink-fill-weak)"; }}
      >
        {t.home.shift.endShift}
      </button>
    </div>
  );
}
