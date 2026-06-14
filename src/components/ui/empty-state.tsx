import type { ReactNode, ElementType } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: ElementType;
  message: string;
  subMessage?: string;
  action?: ReactNode;
  iconBg?: string;
  iconColor?: string;
  borderColor?: string;
  /**
   * Heading level for the message. Defaults to "h2" so the empty state slots
   * directly under a page's <h1> without skipping a level (WCAG 1.3.1 heading
   * order). Pass "h3" when the empty state lives beneath an existing <h2>.
   */
  headingLevel?: "h2" | "h3";
}

export function EmptyState({
  icon: Icon,
  message,
  subMessage,
  action,
  iconBg = "bg-gradient-to-br from-primary/10 to-muted/60 ring-1 ring-border/50",
  iconColor = "text-primary",
  borderColor,
  headingLevel: Heading = "h2",
}: EmptyStateProps) {
  return (
    <Card
      className={cn(
        "max-w-full min-w-0 border border-dashed border-border/70 bg-muted/5 shadow-sm",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300",
        borderColor
      )}
    >
      <CardContent className="space-y-4 p-6 text-center sm:p-8 md:p-10">
        <div
          className={cn(
            "w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-inner",
            iconBg
          )}
        >
          <Icon className={cn("w-8 h-8", iconColor)} />
        </div>
        <Heading className="font-semibold text-lg tracking-tight text-foreground">{message}</Heading>
        {subMessage && (
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">{subMessage}</p>
        )}
        {action && <div className="pt-1">{action}</div>}
      </CardContent>
    </Card>
  );
}
