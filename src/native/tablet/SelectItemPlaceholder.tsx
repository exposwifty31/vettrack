import { MousePointerClick } from "lucide-react";
import { t } from "@/lib/i18n";

type Props = {
  /** Optional override for the primary line (defaults to a generic prompt). */
  title?: string;
  /** Optional override for the secondary line. */
  subtitle?: string;
};

/**
 * Empty right-pane state for the tablet two-pane layout, shown when nothing is
 * selected. Copy is localized (generic defaults from `common.*`); surfaces may
 * pass their own title/subtitle.
 */
export function SelectItemPlaceholder({ title, subtitle }: Props) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 32,
        textAlign: "center",
        color: "hsl(var(--muted-foreground))",
      }}
    >
      <MousePointerClick size={40} strokeWidth={1.5} aria-hidden />
      <p style={{ margin: 0, fontSize: "var(--text-base)", fontWeight: 600, color: "hsl(var(--foreground))" }}>
        {title ?? t.common.selectItemTitle}
      </p>
      <p style={{ margin: 0, fontSize: "var(--text-sm)", maxWidth: 320 }}>
        {subtitle ?? t.common.selectItemSubtitle}
      </p>
    </div>
  );
}
