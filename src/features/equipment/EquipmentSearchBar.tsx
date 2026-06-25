import { Search, X } from "lucide-react";

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
          color: "var(--muted-foreground)",
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
          border: "1px solid var(--border)",
          background: "var(--background)",
          color: "var(--foreground)",
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
          aria-label="Clear search"
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
            background: "var(--muted)",
            border: "none",
            cursor: "pointer",
            color: "var(--muted-foreground)",
          }}
        >
          <X style={{ width: 12, height: 12 }} aria-hidden />
        </button>
      )}
    </div>
  );
}
