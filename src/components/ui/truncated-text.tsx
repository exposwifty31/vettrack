import type { CSSProperties, ElementType } from "react";
import { cn } from "@/lib/utils";

interface TruncatedTextProps {
  text: string;
  className?: string;
  /** Element to render. Defaults to a span. */
  as?: ElementType;
  /** Lines before clamping. 1 (default) = single-line ellipsis. */
  lines?: number;
  /** Override the tooltip; defaults to the full text so the value stays accessible. */
  title?: string;
}

/**
 * Text that clips with an ellipsis while always exposing the full value via the
 * native `title` tooltip, so truncated equipment / item / option names remain
 * identifiable. Single line uses `truncate`; multi-line uses line-clamp.
 *
 * Requires a width-constrained parent (e.g. a flex item with `min-w-0`).
 */
export function TruncatedText({ text, className, as: Tag = "span", lines = 1, title }: TruncatedTextProps) {
  const isMultiLine = lines > 1;
  const style: CSSProperties | undefined = isMultiLine
    ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines }
    : undefined;
  return (
    <Tag
      className={cn("block min-w-0", isMultiLine ? "overflow-hidden" : "truncate", className)}
      style={style}
      title={title ?? text}
    >
      {text}
    </Tag>
  );
}
