// Shared breadcrumb component — RTL-aware, token-styled.
import { Link } from "wouter";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { useDirection } from "@/hooks/useDirection";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  const dir = useDirection();
  const Sep = dir === "rtl" ? ChevronLeft : ChevronRight;

  return (
    <nav
      aria-label="breadcrumb"
      className={cn("flex items-center gap-0.5 text-xs text-ivory-text3", className)}
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={idx} className="flex items-center gap-0.5">
            {idx > 0 && <Sep className="w-3 h-3 shrink-0 opacity-50" aria-hidden />}
            {isLast || !item.href ? (
              <span
                className={cn(
                  isLast
                    ? "font-medium text-ivory-text truncate max-w-[14rem]"
                    : "text-ivory-text3"
                )}
                aria-current={isLast ? "page" : undefined}
              >
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-ivory-text transition-colors duration-100"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
