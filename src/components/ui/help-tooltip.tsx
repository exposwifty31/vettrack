import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";

interface HelpTooltipProps {
  content: string;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function HelpTooltip({ content, side = "bottom", className = "" }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const positionClass =
    side === "top"
      ? "bottom-full mb-2 left-1/2 -translate-x-1/2"
      : side === "left"
      ? "right-full mr-2 top-0"
      : side === "right"
      ? "left-full ml-2 top-0"
      : "top-full mt-2 left-1/2 -translate-x-1/2";

  return (
    <div className={`relative inline-flex shrink-0 ${className}`} ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="w-11 h-11 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted transition-colors"
        aria-label="Help"
        aria-expanded={open}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="tooltip"
          className={`absolute ${positionClass} z-50 w-60 bg-popover border border-border rounded-xl shadow-lg px-3 py-2.5 text-xs text-popover-foreground leading-relaxed`}
          style={{ animation: "fadeIn 0.15s ease" }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
