import { type ReactNode } from "react";

type Props = {
  /** Persistent master pane (list). Stays mounted as the detail swaps. */
  master: ReactNode;
  /** Detail pane content, or null to show the placeholder. */
  detail: ReactNode | null;
  /** Shown in the detail pane when `detail` is null (nothing selected). */
  placeholder?: ReactNode;
  /** Master pane width in px. */
  masterWidth?: number;
  /** Accessible label for the master `<section>`. */
  masterLabel?: string;
  /** Accessible label for the detail `<section>`. */
  detailLabel?: string;
};

/**
 * Two-pane master-detail layout for the native tablet (iPad). Presentational and
 * RTL-correct via logical properties: in a `dir="rtl"` document the master lands
 * on the right automatically (flex row + `borderInlineEnd`), mirroring
 * `NativeTabSidebar`.
 *
 * Nesting note (double-scroll): the row is `height:100%` with `minHeight:0`, and
 * each pane owns its own `overflowY:auto` + `minHeight:0`. This lets it sit
 * inside NativeShell's existing content scroller without the outer scroller
 * engaging — each pane scrolls independently and the list keeps its position as
 * the detail changes.
 */
export function TwoPaneLayout({
  master,
  detail,
  placeholder,
  masterWidth = 380,
  masterLabel,
  detailLabel,
}: Props) {
  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "row" }}>
      <section
        aria-label={masterLabel}
        style={{
          // Responsive master width: shrink with the viewport (fraction) but
          // keep a usable floor and never grow past `masterWidth`, so the
          // detail pane stays wide enough on 11"-class iPads in portrait.
          width: `clamp(260px, 42%, ${masterWidth}px)`,
          flexShrink: 0,
          minHeight: 0,
          overflowY: "auto",
          borderInlineEnd: "0.5px solid hsl(var(--border))",
        }}
      >
        {master}
      </section>
      <section
        aria-label={detailLabel}
        style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
      >
        {detail ?? placeholder ?? null}
      </section>
    </div>
  );
}
