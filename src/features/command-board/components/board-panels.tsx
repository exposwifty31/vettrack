// Phase 5 (C2) — enrichment panels for the Command Center board.
// Presentational leaves mirroring the ReadinessMix / LocationCard idiom (ivory
// surface, vt-text scale, status tokens — never a literal color). Each panel
// receives a DEFINED block; CommandBoard mounts it only behind a presence guard,
// so a panel never sees undefined (the tolerant-reader contract lives at the
// call site).
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  EquipmentBoardCustodyBlock,
  EquipmentBoardDocksBlock,
  EquipmentBoardPowerBlock,
} from "../../../../shared/equipment-board";
import type { BoardResponsibles, DoctorTeamBlock } from "@/types/safety-surfaces";

/** Titled container matching the board's ivory-surface panel idiom. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="w-full rounded-xl border border-ivory-border bg-[rgb(var(--ivory-surface))] px-3 py-2.5">
      <div className="vt-text-2xs font-bold uppercase tracking-widest text-ivory-text3 mb-2">{title}</div>
      {children}
    </div>
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
  return (
    <Panel title={t.board.power}>
      <div className="grid grid-cols-3 gap-2">
        <Stat count={power.plugged} label={t.board.plugged} className="text-[hsl(var(--status-ok))]" />
        <Stat count={power.unplugged} label={t.board.unplugged} className="text-ivory-text2" />
        <Stat count={power.alert} label={t.board.powerAlert} className="text-[hsl(var(--status-issue))]" />
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

// ── ResponsiblesPanel (doctor shift gate, spec 2026-08-13 §3) ────────────────
// Deliberate exception to this file's presence-guard contract: the snapshot's
// `responsibles` key degrades to null/undefined server-side (withTimeout →
// null), and the board must still show the five slots in their notMarked
// state — so THIS panel is the tolerant reader, mounted unconditionally.

/** Member since-time as HH:mm — same he-IL 24h format as the board clock. */
function formatSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Slot label + content stack shared by the five responsibles slots. */
function SlotShell({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className="min-w-0">
      <div className="vt-text-2xs font-semibold uppercase tracking-wider text-ivory-text3 mb-0.5">
        {label}
      </div>
      {children}
    </div>
  );
}

/** Muted empty state — calm by design, never a red/blinking surface. */
function NotMarked() {
  return <div className="vt-text-xs text-ivory-text3">{t.board.notMarked}</div>;
}

function DoctorTeamSlot({ label, block, testId }: { label: string; block: DoctorTeamBlock | undefined; testId: string }) {
  const senior = block?.senior ?? null;
  const members = block?.members ?? [];
  return (
    <SlotShell label={label} testId={testId}>
      {!senior && members.length === 0 ? (
        <NotMarked />
      ) : (
        <>
          {senior ? (
            <div className="vt-text-sm font-bold text-ivory-text truncate" dir="auto">
              {senior.name}
            </div>
          ) : (
            <div className="vt-text-2xs text-ivory-text3">{t.board.noSeniorMarked}</div>
          )}
          {members.map((m) => (
            <div key={`${m.name}-${m.since}`} className="flex items-baseline gap-1.5 min-w-0">
              <span className="vt-text-xs text-ivory-text2 truncate" dir="auto">
                {m.name}
              </span>
              <span className="vt-text-2xs tabular-nums text-ivory-text3 shrink-0">
                {t.board.sincePrefix(formatSince(m.since))}
              </span>
            </div>
          ))}
        </>
      )}
    </SlotShell>
  );
}

function PersonSlot({ label, name, testId }: { label: string; name: string | null; testId: string }) {
  return (
    <SlotShell label={label} testId={testId}>
      {name ? (
        <div className="vt-text-sm font-bold text-ivory-text truncate" dir="auto">
          {name}
        </div>
      ) : (
        <NotMarked />
      )}
    </SlotShell>
  );
}

export function ResponsiblesPanel({
  responsibles,
}: {
  responsibles: BoardResponsibles | null | undefined;
}) {
  const doctors = responsibles?.doctors;
  return (
    <Panel title={t.board.responsiblesTitle}>
      <div className="flex flex-col gap-2.5" data-testid="board-responsibles">
        <DoctorTeamSlot label={t.board.seniorIcu} block={doctors?.icu} testId="board-responsibles-icu" />
        <DoctorTeamSlot
          label={t.board.seniorAdmission}
          block={doctors?.admission}
          testId="board-responsibles-admission"
        />
        <DoctorTeamSlot
          label={t.board.seniorInternal}
          block={doctors?.internal_medicine}
          testId="board-responsibles-internal-medicine"
        />
        <PersonSlot
          label={t.board.seniorTechnician}
          name={responsibles?.seniorTechnician?.name ?? null}
          testId="board-responsibles-senior-technician"
        />
        <PersonSlot
          label={t.board.equipmentCoordinator}
          name={responsibles?.equipmentCoordinator?.name ?? null}
          testId="board-responsibles-equipment-coordinator"
        />
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
