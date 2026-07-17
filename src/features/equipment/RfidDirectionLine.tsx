import type { CSSProperties, ReactNode } from "react";
import { Bdi } from "@/components/ui/bdi";
import { t } from "@/lib/i18n";
import type { RfidDirection } from "@/lib/equipment-rfid-display";

type Props = {
  direction: RfidDirection;
  /** Optional relative-time suffix (already localized), e.g. "2 min ago". */
  relative?: string;
  className?: string;
  style?: CSSProperties;
  testId?: string;
};

const PLACEHOLDER_RE = /(\{from\}|\{to\})/g;

/**
 * Split a directional template ("Exited {from} → {to}" or "Entered {to}") into
 * literal text runs and bidi-isolated room-name nodes. Wrapping each room name
 * in a native `<bdi>` stops a Latin name inside RTL copy (or vice-versa) from
 * reordering the arrow and connective words via the Unicode Bidi Algorithm — the
 * classic RTL "arrow points the wrong way" defect. `from` is `undefined` for an
 * `entered` crossing; its template carries no `{from}` placeholder, so the run
 * is never emitted.
 */
function renderBidiTemplate(
  template: string,
  from: string | undefined,
  to: string,
): ReactNode[] {
  return template.split(PLACEHOLDER_RE).map((segment, i) => {
    if (segment === "{from}") return from !== undefined ? <Bdi key={i}>{from}</Bdi> : null;
    if (segment === "{to}") return <Bdi key={i}>{to}</Bdi>;
    return segment;
  });
}

/**
 * R-M1.4 — renders the RFID movement direction ("exited ER → Ward" / "entered
 * Ward") for the locate list subtitle and the equipment-detail location card.
 * Display only: never overrides an authoritative room, never mutates custody.
 * Callers gate visibility (and freshness) via `getRfidDirection`.
 */
export function RfidDirectionLine({ direction, relative, className, style, testId }: Props) {
  const template =
    direction.kind === "exited"
      ? t.equipment.rfidDirection.exitedTemplate
      : t.equipment.rfidDirection.enteredTemplate;
  const from = direction.kind === "exited" ? direction.fromRoomName : undefined;
  const nodes = renderBidiTemplate(template, from, direction.toRoomName);
  return (
    <p className={className} style={style} data-testid={testId}>
      {nodes}
      {relative && (
        <>
          {" · "}
          <Bdi>{relative}</Bdi>
        </>
      )}
    </p>
  );
}
