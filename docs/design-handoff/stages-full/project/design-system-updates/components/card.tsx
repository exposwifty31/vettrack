import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Design System Alignment — §33-D2 (Phase 14) + §34-D1 (Phase 15) + §35-D4
 * (Phase 16) + Phase 21 (review items 4 "Card Internal Rhythm" and 6 "Soft
 * Surface Separation").
 *
 * Two INDEPENDENT axes, not one enum — a card's clickability and its
 * operational urgency are orthogonal (a critical alert card can also be
 * tappable):
 *
 *   variant (interactivity)
 *     - primary (DEFAULT)  — background + subtle border, no shadow, PLUS
 *                            (Phase 21) a subtle inset top highlight —
 *                            "border + inset highlight instead of
 *                            box-shadow", the review's own framing for
 *                            Apple Health / Linear-style depth. New token,
 *                            --card-inset-highlight (light/dark), in
 *                            tokens/phase21-card-tokens.css. Static,
 *                            non-interactive containers — the common case.
 *     - interactive        — adds shadow-card + hover:shadow-card-hover + a
 *                            gentle lift + cursor-pointer. Reserve for cards
 *                            that are ACTUALLY clickable/tappable. Does NOT
 *                            get the inset highlight — stacking a sheen on
 *                            top of a real drop shadow reads muddy, not
 *                            premium; the two treatments are for the two
 *                            different depth languages (flat-with-sheen vs.
 *                            elevated), not layered together.
 *
 *   criticality (operational urgency — §34, "criticality system")
 *     - normal (DEFAULT)   — no extra treatment; inherits variant's neutral
 *                            surface as-is.
 *     - attention          — amber accent rail (border-s-4) + soft amber
 *                            tint background. Reuses the real
 *                            --status-maintenance/--status-maint-bg tokens
 *                            (the app's existing "maintenance" semantic —
 *                            no new color invented).
 *     - critical           — red accent rail (border-s-4 border-s-destructive)
 *                            + shadow-card-hover ("elevated card"). NO bg
 *                            tint, by design (the review's own spec lists a
 *                            tint for Attention but not Critical — a
 *                            restrained rail reads as more serious than a
 *                            flooded-red background). Pair with a
 *                            high-contrast CardTitle ("strong title" — plain
 *                            text-foreground font-bold, not
 *                            muted-foreground) — Card can't enforce that on
 *                            a free-form child, it's a usage note.
 *     - maintenance        — "not broken, not urgent, but action required"
 *                            (e.g. preventive service due). Blue-green rail,
 *                            reusing the real --action/--action-soft tokens
 *                            (Phase 12's richer emerald-forest accent, hue
 *                            ~164 — a genuine teal/blue-green, not a re-skin
 *                            of attention's amber or critical's red).
 *                            NAMING COLLISION, flagged not hidden: the real
 *                            app's StatusKind ALSO has a "maintenance"
 *                            value (equipment currently out for repair —
 *                            amber, via StatusBadge). Card's
 *                            criticality="maintenance" is a different
 *                            namespace/prop and means something distinct
 *                            (preventive, scheduled, not-yet-broken) — see
 *                            README §35-D4 before assuming the two share a
 *                            color or meaning.
 *
 * §33-D2's blast-radius note still applies: variant defaults to "primary"
 * (no shadow), a real, wide change from the pre-Phase-14 flat Card style —
 * see README §33-D4.
 *
 * Phase 21's CardHeader/CardContent rhythm reconciles the review's literal
 * header-bottom/status-gap/body-gap spec (12/20/24px) onto Tailwind's OWN
 * spacing scale (pb-3 / space-y-5) — NOT new spacing tokens. Every layout
 * value in this codebase is already a literal Tailwind utility; custom
 * properties are reserved for colors/shadows/type scale (see
 * src/index.css). The review's 4-number rhythm (header/status/body/footer)
 * doesn't map onto this component's 3-slot API (header/content/footer) with
 * a distinct "status" region — collapsed the status-gap(20)/body-gap(24)
 * pair onto ONE CardContent default (space-y-5, 20px: the more common case
 * of a status line or short fact sitting right under the header) rather
 * than inventing a 4th slot the real API has no caller-visible need for;
 * call sites with longer stacked prose can opt into space-y-6 (24px) via
 * className, which tailwind-merge resolves cleanly (cn() puts the caller's
 * className last). CardFooter is UNCHANGED — the review's 16px
 * "footer-gap" already exists today via CardContent's own pb-4 sitting
 * above it; verified by reading the rendered gap, not re-implemented.
 * Blast radius, stated plainly: CardContent's new space-y-5 default reaches
 * every real call site with multiple direct children AND no className
 * override of its own — which, from every real file read this phase
 * (EquipmentTruthCard, EmptyState, EquipmentDetailStatusStrip), is already
 * the minority (most already set their own space-y-N). Not individually
 * re-audited beyond those files — same "flag, don't guess" posture as
 * every prior phase's wide changes.
 */
const cardVariants = cva(
  "rounded-2xl text-card-foreground transition-all duration-200",
  {
    variants: {
      variant: {
        primary: "border border-border bg-card shadow-[var(--card-inset-highlight)]",
        interactive: "border border-border bg-card shadow-card hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer",
      },
      criticality: {
        normal: "",
        attention: "border-s-4 border-s-[hsl(var(--status-maintenance))] bg-[var(--status-maint-bg)]",
        critical: "border-s-4 border-s-destructive shadow-card-hover",
        maintenance: "border-s-4 border-s-[var(--action)] bg-[var(--action-soft)]",
      },
    },
    defaultVariants: { variant: "primary", criticality: "normal" },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, criticality, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, criticality }), className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 pt-4 px-4 pb-3", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-lg font-semibold leading-tight tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0 space-y-5", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
