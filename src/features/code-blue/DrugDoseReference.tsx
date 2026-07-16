import { useState } from "react";
import { ChevronDown, Pill } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import {
  DRUG_DOSE_REFERENCE,
  approvedDrugDoseEntries,
  type DrugDoseEntry,
} from "./drug-reference";

/**
 * R-CBF-1.4 — inline, static, clinician-approved emergency dose reference for
 * the Code Blue timed log.
 *
 * Reference DATA, not a new domain: rendered entirely from the bundled table
 * (no network dependency, no clinic-config in v1). Clinical safety is the whole
 * point — only provenance-VALID entries are surfaced (`approvedDrugDoseEntries`),
 * and each row carries its own source / version / effective-date / review-owner
 * so a stale or unsourced dose can never read as authoritative guidance.
 */

interface DrugDoseReferenceProps {
  /** Render expanded on mount (used inline in the active-session log view). */
  defaultOpen?: boolean;
}

function ProvenanceLine({ entry }: { entry: DrugDoseEntry }) {
  const r = t.codeBlue.drugReference;
  return (
    <div className="mt-1 text-[10px] leading-tight text-emergency-text2/70">
      {r.sourceLabel}: {entry.source} · {r.versionLabel} {entry.version} · {r.effectiveLabel} {entry.effectiveDate} · {r.reviewOwnerLabel}: {entry.reviewOwner}
    </div>
  );
}

function DrugEntryRow({ entry }: { entry: DrugDoseEntry }) {
  const r = t.codeBlue.drugReference;
  const speciesLabel = r.species[entry.species];
  return (
    <div
      data-testid={`cb-drug-entry-${entry.id}`}
      className="rounded-lg border border-emergency-border bg-emergency-surface/60 p-2.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-emergency-text">{entry.drug}</span>
        <span className="shrink-0 vt-text-2xs uppercase tracking-wide rounded bg-emergency-border px-1.5 py-0.5 text-emergency-text2">
          {speciesLabel}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-emergency-amber font-semibold">{entry.dose}</div>
      <div className="mt-0.5 text-[11px] text-emergency-text2">{entry.indication}</div>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        <div className="flex gap-1">
          <dt className="text-emergency-text2/70">{r.weightBandLabel}:</dt>
          <dd className="text-emergency-text2 font-num">{entry.weightBandKg.minKg}–{entry.weightBandKg.maxKg} {r.kg}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-emergency-text2/70">{r.doseUnitLabel}:</dt>
          <dd className="text-emergency-text2">{entry.unit}</dd>
        </div>
        <div className="flex gap-1 col-span-2">
          <dt className="text-emergency-text2/70">{r.concentrationLabel}:</dt>
          <dd className="text-emergency-text2">{entry.concentration}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-emergency-text2/70">{r.routeLabel}:</dt>
          <dd className="text-emergency-text2">{entry.route}</dd>
        </div>
      </dl>
      <ProvenanceLine entry={entry} />
    </div>
  );
}

export function DrugDoseReference({ defaultOpen = false }: DrugDoseReferenceProps) {
  const [open, setOpen] = useState(defaultOpen);
  const r = t.codeBlue.drugReference;
  const entries = approvedDrugDoseEntries();

  return (
    <section data-testid="cb-drug-reference" aria-label={r.title}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="cb-drug-reference-panel"
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-emergency-border bg-emergency-surface/60 px-3 py-2 text-start min-h-[44px]"
      >
        <span className="flex items-center gap-2">
          <Pill className="h-4 w-4 text-emergency-amber" aria-hidden />
          <span className="text-xs font-semibold text-emergency-text">{r.title}</span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-emergency-text2 transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div id="cb-drug-reference-panel" className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] text-emergency-text2/80">{r.subtitle}</p>

          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <DrugEntryRow key={entry.id} entry={entry} />
            ))}
          </div>

          {/* Table-level provenance — the reference is versioned and sourced. */}
          <div
            data-testid="cb-drug-reference-provenance"
            className="rounded-lg border border-emergency-border/60 bg-emergency-surface/40 p-2.5 text-[10px] leading-relaxed text-emergency-text2/70"
          >
            <div className="mb-1 vt-text-2xs font-bold uppercase tracking-widest text-emergency-text2/80">
              {r.provenanceHeading}
            </div>
            <div>{r.sourceLabel}: {DRUG_DOSE_REFERENCE.source}</div>
            <div>
              {r.versionLabel} {DRUG_DOSE_REFERENCE.version} · {r.effectiveLabel} {DRUG_DOSE_REFERENCE.effectiveDate}
            </div>
            <div>{r.reviewOwnerLabel}: {DRUG_DOSE_REFERENCE.reviewOwner}</div>
            <p className="mt-1.5 text-emergency-amber/80">{r.disclaimer}</p>
          </div>
        </div>
      )}
    </section>
  );
}
