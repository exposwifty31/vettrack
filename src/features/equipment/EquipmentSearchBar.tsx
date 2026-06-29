import { Search, X } from "lucide-react";
import { t } from "@/lib/i18n";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
};

export function EquipmentSearchBar({ value, onChange, placeholder }: Props) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
      }}
    >
      <Search
        aria-hidden
        style={{
          position: "absolute",
          insetInlineStart: 14,
          width: 16,
          height: 16,
          color: "hsl(var(--muted-foreground))",
          flexShrink: 0,
        }}
      />
      <input
        type="search"
        autoComplete="off"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 42,
          borderRadius: 9999,
          border: "1px solid hsl(var(--border))",
          background: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
          fontSize: "var(--text-sm)",
          paddingInlineStart: 40,
          paddingInlineEnd: value ? 40 : 16,
          outline: "none",
          WebkitAppearance: "none",
        }}
      />
      {value && (
        <button
          type="button"
          aria-label={t.equipmentList.search.clearLabel}
          onClick={() => onChange("")}
          style={{
            position: "absolute",
            insetInlineEnd: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "hsl(var(--muted))",
            border: "none",
            cursor: "pointer",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <X style={{ width: 12, height: 12 }} aria-hidden />
        </button>
      )}
    </div>
  );
}
