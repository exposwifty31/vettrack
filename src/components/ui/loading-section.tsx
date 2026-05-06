import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface LoadingSectionProps {
  rows?: number;
  label?: string;
  className?: string;
}

export function LoadingSection({ rows = 3, label, className }: LoadingSectionProps) {
  return (
    <div
      role="status"
      aria-label={label ?? t.common.loading}
      aria-busy="true"
      className={cn("space-y-2", className)}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-12 w-full rounded-xl"
          style={{ opacity: Math.max(0.3, 1 - i * 0.2) }}
        />
      ))}
      <span className="sr-only">{label ?? t.common.loading}</span>
    </div>
  );
}
