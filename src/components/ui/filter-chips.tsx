import { cn } from "@/lib/utils";

export interface FilterChipOption {
  value: string;
  label: string;
  count?: number;
  tone?: "default" | "err";
}

interface FilterChipsProps {
  options: FilterChipOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  "data-testid"?: string;
}

/** Horizontal filter chips — Pro equipment / alerts pattern. */
export function FilterChips({
  options,
  value,
  onChange,
  className,
  "data-testid": testId,
}: FilterChipsProps) {
  return (
    <div
      className={cn("flex gap-2 overflow-x-auto pb-1 scrollbar-none", className)}
      data-testid={testId}
    >
      {options.map((opt) => {
        const on = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors motion-safe:active:scale-[0.97]",
              on
                ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                : "border-ivory-border bg-ivory-surface text-ivory-text2 hover:border-primary/30",
              opt.tone === "err" && !on && "text-destructive",
            )}
            data-testid={testId ? `${testId}-${opt.value}` : undefined}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={cn("font-num text-[11px]", on ? "opacity-90" : "opacity-60")}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
