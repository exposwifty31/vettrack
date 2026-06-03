import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionListSection<T> {
  key: string;
  label: string;
  items: T[];
}

interface SectionListProps<T> {
  sections: SectionListSection<T>[];
  renderItem: (item: T, index: number) => ReactNode;
  empty?: ReactNode;
  className?: string;
}

/** Sticky section headers + flat rows (equipment triage). */
export function SectionList<T>({
  sections,
  renderItem,
  empty,
  className,
}: SectionListProps<T>) {
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  if (total === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {sections.map((section) =>
        section.items.length === 0 ? null : (
          <div key={section.key} className="mb-3 last:mb-0">
            <div
              className="sticky top-0 z-[20] -mx-0.5 bg-background/95 px-0.5 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ivory-text3 backdrop-blur-sm"
              role="heading"
              aria-level={3}
            >
              {section.label}
            </div>
            <div className="overflow-hidden rounded-xl border border-ivory-border bg-ivory-surface">
              {section.items.map((item, i) => (
                <div
                  key={i}
                  className={cn(i < section.items.length - 1 && "border-b border-ivory-border/70")}
                >
                  {renderItem(item, i)}
                </div>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
