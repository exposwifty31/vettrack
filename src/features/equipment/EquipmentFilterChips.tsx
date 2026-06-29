import { t } from "@/lib/i18n";

const CHIPS: { value: string; label: string }[] = [
  { value: "all", label: t.status.all },
  { value: "ok", label: t.status.ok },
  { value: "issue", label: t.status.issue },
  { value: "maintenance", label: t.status.maintenance },
  { value: "sterilized", label: t.status.sterilized },
];

type Props = {
  value: string;
  onChange: (v: string) => void;
};

export function EquipmentFilterChips({ value, onChange }: Props) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {CHIPS.map((chip) => {
        const active = chip.value === value;
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onChange(chip.value)}
            aria-pressed={active}
            style={{
              flexShrink: 0,
              height: 36,
              paddingInline: 16,
              borderRadius: 9999,
              border: `1px solid ${active ? "var(--brand)" : "hsl(var(--border))"}`,
              background: active ? "var(--brand)" : "hsl(var(--background))",
              color: active ? "#fff" : "hsl(var(--muted-foreground))",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
              WebkitTapHighlightColor: "transparent",
              transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
