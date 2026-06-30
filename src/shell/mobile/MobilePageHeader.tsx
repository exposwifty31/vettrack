import { BackChevron } from "@/components/ui/directional-chevron";
import { t } from "@/lib/i18n";

type Props = {
  title: string;
  onBack?: () => void;
};

export function MobilePageHeader({ title, onBack }: Props) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        height: 44,
        paddingInline: 8,
        gap: 4,
        background: "hsl(var(--background))",
        borderBottom: "0.5px solid rgba(60,60,67,0.18)",
        flexShrink: 0,
      }}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label={t.common.back}
          style={{
            width: 48,
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            color: "hsl(var(--primary))",
            WebkitTapHighlightColor: "transparent",
            flexShrink: 0,
          }}
        >
          <BackChevron size={24} />
        </button>
      ) : (
        <div style={{ width: 44, flexShrink: 0 }} />
      )}
      <span
        style={{
          fontSize: "var(--text-base)",
          fontWeight: 600,
          color: "hsl(var(--foreground))",
          flex: 1,
          paddingInlineStart: 4,
        }}
      >
        {title}
      </span>
    </div>
  );
}
