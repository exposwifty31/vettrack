import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShoppingCart, Gauge } from "lucide-react";
import { t } from "@/lib/i18n";
import { Bdi } from "@/components/ui/bdi";
import { Button } from "@/components/ui/button";
import type {
  ReadinessForecast,
  ReadinessPoRecommendation,
  ReadinessShortfallWarning,
} from "@/types/readiness-forecast";

/**
 * R-PDF-1.4 — predictive-readiness panel inside the EXISTING Analytics console
 * (no new surface family; no home tile). Presentational only: it renders the
 * redacted forecast DTO (source-row refs + counts, never PII). Rendering or
 * refreshing creates ZERO purchase orders — a PO is created only through the
 * explicit confirm + the caller's authorized `onCreatePurchaseOrder` handler.
 *
 * Accessibility: a single region heading (h2 — the page owns the h1), semantic
 * heading order (h3 subsections), status by icon + text (never color alone),
 * status colors drawn from the AA-verified --status-* token families, and
 * bidi-isolated dynamic content for correct RTL in he + en.
 */

const HEADING_ID = "readiness-forecast-heading";

interface ReadinessForecastPanelProps {
  data: ReadinessForecast | undefined;
  onCreatePurchaseOrder?: (recommendation: ReadinessPoRecommendation) => void;
}

export function ReadinessForecastPanel({ data, onCreatePurchaseOrder }: ReadinessForecastPanelProps) {
  const warnings = data?.warnings ?? [];
  const recommendations = data?.recommendations ?? [];
  const horizonHours = data?.horizonHours ?? 24;
  const healthy = warnings.length === 0;

  return (
    <section
      aria-labelledby={HEADING_ID}
      className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
    >
      <div className="mb-3 flex items-start gap-2">
        <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 id={HEADING_ID} className="text-base font-semibold leading-tight text-foreground">
            {t.readinessForecast.title}
          </h2>
          <p className="text-xs text-muted-foreground">{t.readinessForecast.subtitle(horizonHours)}</p>
        </div>
      </div>

      {healthy ? (
        <div className="flex flex-col items-center gap-1 rounded-xl bg-[hsl(var(--status-ok-bg))] px-4 py-6 text-center">
          <CheckCircle2 className="h-6 w-6 text-[hsl(var(--status-ok-fg))]" aria-hidden="true" />
          <p className="text-sm font-semibold text-[hsl(var(--status-ok-fg))]">
            {t.readinessForecast.allReadyTitle}
          </p>
          <p className="text-xs text-muted-foreground">{t.readinessForecast.allReadyBody}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">
              {t.readinessForecast.shortfallsHeading}
            </h3>
            <ul className="flex flex-col gap-2">
              {warnings.map((w) => (
                <WarningRow key={w.keyId} warning={w} />
              ))}
            </ul>
          </div>

          {recommendations.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-foreground">
                {t.readinessForecast.recommendationsHeading}
              </h3>
              <p className="mb-2 text-xs text-muted-foreground">{t.readinessForecast.recommendedOnly}</p>
              <ul className="flex flex-col gap-2">
                {recommendations.map((r) => (
                  <RecommendationRow key={r.shortfallKeyId} recommendation={r} onCreate={onCreatePurchaseOrder} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function WarningRow({ warning: w }: { warning: ReadinessShortfallWarning }) {
  const kindLabel =
    w.kind === "equipment" ? t.readinessForecast.equipmentKind : t.readinessForecast.consumableKind;
  return (
    <li
      data-testid={`readiness-warning-${w.keyId}`}
      className="rounded-xl border border-border/50 bg-[hsl(var(--status-issue-bg))] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <AlertTriangle
            className="h-4 w-4 shrink-0 text-[hsl(var(--status-issue-fg))]"
            aria-hidden="true"
          />
          <span className="min-w-0 text-sm font-medium text-foreground">
            <Bdi>{w.ref}</Bdi>
            <span className="ms-1 text-xs text-muted-foreground">({kindLabel})</span>
          </span>
        </div>
        <span className="shrink-0 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold text-[hsl(var(--status-issue-fg))]">
          {t.readinessForecast.shortBadge(w.shortfall, w.unit)}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          {t.readinessForecast.requiredLabel}: <span className="tabular-nums">{w.required}</span>
        </span>
        <span>
          {t.readinessForecast.availableLabel}: <span className="tabular-nums">{w.available}</span>
        </span>
        <span>{t.readinessForecast.sourceLine(w.sourceAppointmentCount)}</span>
        {w.burnConsumedUnits != null && <span>{t.readinessForecast.burnLine(w.burnConsumedUnits)}</span>}
        {w.incomingUnits > 0 && <span>{t.readinessForecast.incomingLine(w.incomingUnits)}</span>}
      </div>

      {w.sourceAppointmentIds.length > 0 && (
        <p className="mt-1 truncate text-[11px] text-muted-foreground/80">
          {t.readinessForecast.sourceRefsLabel}:{" "}
          <span className="font-mono">{w.sourceAppointmentIds.join(", ")}</span>
        </p>
      )}
    </li>
  );
}

function RecommendationRow({
  recommendation: rec,
  onCreate,
}: {
  recommendation: ReadinessPoRecommendation;
  onCreate?: (recommendation: ReadinessPoRecommendation) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-muted/30 p-3">
      <div className="min-w-0 text-sm">
        <span className="font-medium text-foreground">
          <Bdi>{rec.itemId}</Bdi>
        </span>
        <span className="ms-2 text-xs text-muted-foreground">
          {t.readinessForecast.suggestedQtyLabel}:{" "}
          <span className="tabular-nums">
            {rec.suggestedQuantity} {rec.unit}
          </span>
        </span>
      </div>
      {confirming ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              onCreate?.(rec);
              setConfirming(false);
            }}
          >
            <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
            {t.readinessForecast.confirmPo}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            {t.readinessForecast.cancelPo}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfirming(true)}>
          <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
          {t.readinessForecast.createPo}
        </Button>
      )}
    </li>
  );
}
