// Phase 5 (C2) — enrichment panels for the Command Center board.
// Presentational leaves mirroring the ReadinessMix / LocationCard idiom (ivory
// surface, vt-text scale, status tokens — never a literal color). Each panel
// receives a DEFINED block; CommandBoard mounts it only behind a presence guard,
// so a panel never sees undefined (the tolerant-reader contract lives at the
// call site).
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  EquipmentBoardCustodyBlock,
  EquipmentBoardDocksBlock,
  EquipmentBoardPowerBlock,
} from "../../../../shared/equipment-board";
import type { BoardResponsibles, DoctorTeamBlock } from "@/types/safety-surfaces";
import {
  coordinatorSlotFill,
  countFilledSlots,
  doctorSlotFill,
  type SlotFill,
} from "../responsibles-fill";

/** Titled container matching the board's ivory-surface panel idiom. */
function Panel({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="w-full rounded-xl border border-ivory-border bg-[rgb(var(--ivory-surface))] px-3 py-2.5"
    >
      <div className="vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3 mb-2">{title}</div>
      {children}
    </div>
  );
}

/**
 * Muted-unknown treatment for an ABSENT optional snapshot block (Phase 1,
 * absent ≠ zero — binding). An undefined block means the server-side producer
 * degraded, not that the count is zero: render the block's title + a quiet
 * "unavailable" line, never a numeral.
 */
export function UnknownBlock({ title }: { title: string }): JSX.Element {
  return (
    <Panel title={title} testId="board-block-unknown">
      <div className="vt-text-xs text-ivory-text3">{t.board.blockUnavailable}</div>
    </Panel>
  );
}

function Stat({ count, label, className }: { count: number; label: string; className?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={cn("vt-text-lg font-black tabular-nums leading-none", className)}>{count}</span>
      <span className="vt-text-2xs text-ivory-text3 mt-0.5 text-center">{label}</span>
    </div>
  );
}

/** Single big-number depth panel (waitlist / staging). */
function DepthPanel({ title, depth }: { title: string; depth: number }) {
  return (
    <Panel title={title}>
      <div className="flex items-baseline gap-2">
        <span className="vt-text-2xl font-black tabular-nums text-ivory-text leading-none">{depth}</span>
        <span className="vt-text-xs text-ivory-text3">{t.board.inQueue}</span>
      </div>
    </Panel>
  );
}

export function PowerPanel({ power }: { power: EquipmentBoardPowerBlock }) {
  // Red is an alarm color on the board: it appears only when alerts are ACTIVE.
  // A zero renders neutral — never a red zero (status semantics, Phase 1 §3).
  const alertActive = power.alert > 0;
  return (
    <Panel title={t.board.power}>
      <div className="grid grid-cols-3 gap-2">
        <Stat count={power.plugged} label={t.board.plugged} className="text-[hsl(var(--status-ok))]" />
        <Stat count={power.unplugged} label={t.board.unplugged} className="text-ivory-text2" />
        <div className="flex flex-col items-center">
          <span
            data-testid="board-power-alerts"
            data-severity={alertActive ? "active" : "none"}
            className={cn(
              "inline-flex items-center gap-1 vt-text-lg font-black tabular-nums leading-none",
              alertActive ? "text-[hsl(var(--status-issue))]" : "text-ivory-text2",
            )}
          >
            {alertActive ? (
              <TriangleAlert
                data-testid="board-power-alert-icon"
                aria-hidden="true"
                className="size-[0.8em] shrink-0"
              />
            ) : null}
            {power.alert}
          </span>
          <span className="vt-text-2xs text-ivory-text3 mt-0.5 text-center">{t.board.powerAlert}</span>
        </div>
      </div>
    </Panel>
  );
}

export function DocksPanel({ docks }: { docks: EquipmentBoardDocksBlock }) {
  return (
    <Panel title={t.board.docks}>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          count={docks.occupied}
          label={`${t.board.docksOccupied} / ${docks.total}`}
          className="text-ivory-text"
        />
        <Stat count={docks.ready} label={t.board.docksReady} className="text-[hsl(var(--status-ok))]" />
      </div>
    </Panel>
  );
}

export function WaitlistPanel({ depth }: { depth: number }) {
  return <DepthPanel title={t.board.waitlist} depth={depth} />;
}

export function StagingPanel({ depth }: { depth: number }) {
  return <DepthPanel title={t.board.staging} depth={depth} />;
}

// ── ResponsiblesPanel v2 (TV board phase 1, spec §4) ─────────────────────────
// Deliberate exception to this file's presence-guard contract: the snapshot's
// `responsibles` key degrades to null/undefined server-side (withTimeout →
// null), and the board must still render — so THIS panel is the tolerant
// reader, mounted unconditionally. Absent ≠ zero (binding): a null payload
// renders the muted "unavailable" treatment, NEVER the 0/5 aggregate.
// Fill mapping lives in ../responsibles-fill.ts (pure, tested separately).

/** Member since-time as HH:mm — same he-IL 24h format as the board clock. */
function formatSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Slot label + content stack shared by the filled responsibles slots. */
function SlotShell({
  label,
  testId,
  fill,
  children,
}: {
  label: string;
  testId: string;
  fill: SlotFill;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} data-fill={fill} className="min-w-0">
      <div className="vt-text-2xs font-semibold uppercase tracking-wider text-ivory-text3 mb-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Doctor team slot — mounted only when filled or filled_flagged. */
function DoctorTeamSlot({ label, block, testId }: { label: string; block: DoctorTeamBlock; testId: string }) {
  const fill = doctorSlotFill(block);
  if (!block.senior) {
    // Members without a senior — covered but flagged: count + amber accent.
    return (
      <SlotShell label={label} testId={testId} fill={fill}>
        <div className="board-slot-name vt-text-sm font-bold tabular-nums text-ivory-text">
          {t.board.responsiblesDoctorCount(block.members.length)}
        </div>
        <div className="vt-text-2xs font-semibold text-[color:var(--ivory-warn)]">
          {t.board.responsiblesNoSenior}
        </div>
      </SlotShell>
    );
  }
  return (
    <SlotShell label={label} testId={testId} fill={fill}>
      <div className="board-slot-name vt-text-sm font-bold text-ivory-text truncate" dir="auto">
        {block.senior.name}
      </div>
      {block.members.map((m) => (
        <div key={`${m.name}-${m.since}`} className="flex items-baseline gap-1.5 min-w-0">
          <span className="vt-text-xs text-ivory-text2 truncate" dir="auto">
            {m.name}
          </span>
          <span className="vt-text-2xs tabular-nums text-ivory-text3 shrink-0">
            {t.board.sincePrefix(formatSince(m.since))}
          </span>
        </div>
      ))}
    </SlotShell>
  );
}

/** Named person slot (senior technician / coordinator) — mounted only when filled. */
function PersonSlot({
  label,
  name,
  fill,
  testId,
}: {
  label: string;
  name: string | null;
  fill: SlotFill;
  testId: string;
}) {
  const flagged = fill === "filled_flagged";
  return (
    <SlotShell label={label} testId={testId} fill={fill}>
      {name ? (
        <div
          className={cn(
            "board-slot-name vt-text-sm font-bold truncate",
            flagged ? "text-[color:var(--ivory-warn)]" : "text-ivory-text",
          )}
          dir="auto"
        >
          {name}
        </div>
      ) : null}
    </SlotShell>
  );
}

const RESPONSIBLES_SLOT_COUNT = 5;

/** Segmented N/5 progress — fills LTR even in Hebrew (Material 3 exception). */
function AggregateProgress({ filled }: { filled: number }) {
  return (
    <div data-testid="board-responsibles-progress" dir="ltr" className="flex gap-1" aria-hidden="true">
      {Array.from({ length: RESPONSIBLES_SLOT_COUNT }, (_, i) => (
        <span
          key={i}
          data-filled={i < filled ? "true" : "false"}
          className={cn(
            "h-1.5 flex-1 rounded-full",
            i < filled ? "bg-[hsl(var(--status-ok))]" : "bg-ivory-border",
          )}
        />
      ))}
    </div>
  );
}

export function ResponsiblesPanel({
  responsibles,
}: {
  responsibles: BoardResponsibles | null | undefined;
}) {
  // Build failure / pre-deploy server: unknown, not "nobody signed in".
  if (!responsibles) {
    return (
      <Panel title={t.board.responsiblesTitle}>
        <div data-testid="board-responsibles" className="vt-text-xs text-ivory-text3">
          {t.board.responsiblesUnavailable}
        </div>
      </Panel>
    );
  }

  const doctorSlots = [
    { label: t.board.seniorIcu, testId: "board-responsibles-icu", block: responsibles.doctors.icu },
    { label: t.board.seniorAdmission, testId: "board-responsibles-admission", block: responsibles.doctors.admission },
    { label: t.board.seniorInternal, testId: "board-responsibles-internal-medicine", block: responsibles.doctors.internal_medicine },
  ];
  const techName = responsibles.seniorTechnician?.name ?? null;
  const coordFill = coordinatorSlotFill(responsibles.equipmentCoordinator.status);
  const filledCount = countFilledSlots(responsibles);

  if (filledCount === 0) {
    // All five empty — single aggregate row instead of five repeated rows.
    return (
      <Panel title={t.board.responsiblesTitle}>
        <div className="flex flex-col gap-2" data-testid="board-responsibles">
          <div className="board-slot-name vt-text-sm font-bold tabular-nums text-ivory-text">
            {t.board.responsiblesAggregate(0)}
          </div>
          <AggregateProgress filled={0} />
          <div className="vt-text-2xs text-ivory-text3">
            {[...doctorSlots.map((s) => s.label), t.board.seniorTechnician, t.board.equipmentCoordinator].join(" · ")}
          </div>
          <div className="vt-text-2xs text-ivory-text3">{t.board.responsiblesNoneShift}</div>
        </div>
      </Panel>
    );
  }

  const emptyLabels: string[] = [];
  const slotEls: ReactNode[] = [];
  for (const s of doctorSlots) {
    if (doctorSlotFill(s.block) === "empty") emptyLabels.push(s.label);
    else slotEls.push(<DoctorTeamSlot key={s.testId} label={s.label} block={s.block} testId={s.testId} />);
  }
  if (techName) {
    slotEls.push(
      <PersonSlot
        key="board-responsibles-senior-technician"
        label={t.board.seniorTechnician}
        name={techName}
        fill="filled"
        testId="board-responsibles-senior-technician"
      />,
    );
  } else {
    emptyLabels.push(t.board.seniorTechnician);
  }
  if (coordFill === "empty") {
    emptyLabels.push(t.board.equipmentCoordinator);
  } else {
    slotEls.push(
      <PersonSlot
        key="board-responsibles-equipment-coordinator"
        label={t.board.equipmentCoordinator}
        name={responsibles.equipmentCoordinator.name}
        fill={coordFill}
        testId="board-responsibles-equipment-coordinator"
      />,
    );
  }

  return (
    <Panel title={t.board.responsiblesTitle}>
      <div className="flex flex-col gap-2.5" data-testid="board-responsibles">
        {slotEls}
        {emptyLabels.length > 0 ? (
          // Empty slots collapse into ONE muted line — never N repeated rows.
          <div data-testid="board-responsibles-empty-group" className="vt-text-2xs text-ivory-text3">
            {emptyLabels.join(" · ")} — {t.board.notMarked}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function CustodyPanel({ custody }: { custody: EquipmentBoardCustodyBlock }) {
  return (
    <Panel title={t.board.custody}>
      <div className="flex flex-col gap-1">
        {custody.units.map((u) => (
          <div key={u.equipmentId} className="flex items-baseline gap-2 min-w-0">
            <span className="vt-text-sm truncate">{u.displayName}</span>
            <span className="vt-text-xs text-ivory-text2 truncate" dir="auto">
              {u.custodianName}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
