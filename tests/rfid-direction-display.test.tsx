/**
 * @vitest-environment happy-dom
 *
 * R-M1.4 — Surface RFID direction ("exited ER → Ward" / "entered Ward") in the
 * locate list and the equipment-detail location card. DISPLAY ONLY: this never
 * mutates custody and never overrides an authoritative room (R-M1.0 precedence).
 * The freshness gate (`RFID_SUBTITLE_MAX_AGE_MS`) is preserved — a stale read
 * surfaces nothing.
 *
 * PINNED (re-attempt): `getRfidDirection` derives both endpoints of a SINGLE
 * crossing. When the latest read resolved an origin room it is an `exited`
 * from→to pair; when it did not (entered-from-external / first-ever read, origin
 * NULL) it is an `entered {to}` line — the "entered" copy is wired, not inert.
 *
 * Asserts:
 *  - the pure `getRfidDirection` gate (fresh + a resolvable destination);
 *  - the exited AND entered arrow/copy render in BOTH he and en;
 *  - room names are bidi-isolated (`<bdi>`) so a Latin room name inside RTL copy
 *    (or vice-versa) cannot reorder the arrow / connective words.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  getRfidDirection,
  RFID_SUBTITLE_MAX_AGE_MS,
} from "@/lib/equipment-rfid-display";
import { RfidDirectionLine } from "@/features/equipment/RfidDirectionLine";
import { refreshTranslations } from "@/lib/i18n";

const NOW = new Date("2026-07-17T12:00:00.000Z").getTime();
const FRESH = new Date(NOW - 60 * 1000).toISOString(); // 1 min ago
const STALE = new Date(NOW - RFID_SUBTITLE_MAX_AGE_MS - 1000).toISOString();

afterEach(() => {
  cleanup();
  refreshTranslations("he");
});
beforeEach(() => refreshTranslations("he"));

describe("getRfidDirection — freshness + single-crossing gate (R-M1.4, display only)", () => {
  it("returns an `exited` from→to pair for a fresh directional read with an origin", () => {
    const dir = getRfidDirection(
      {
        lastRfidSeenAt: FRESH,
        lastRfidRoomName: "Ward",
        lastRfidFromRoomName: "ER",
      },
      NOW,
    );
    expect(dir).toEqual({ kind: "exited", fromRoomName: "ER", toRoomName: "Ward" });
  });

  it("returns an `entered` line when the latest crossing had no origin room (external / first read)", () => {
    const dir = getRfidDirection(
      { lastRfidSeenAt: FRESH, lastRfidRoomName: "Ward", lastRfidFromRoomName: null },
      NOW,
    );
    expect(dir).toEqual({ kind: "entered", toRoomName: "Ward" });
  });

  it("returns null when the read is stale (freshness gate preserved)", () => {
    expect(
      getRfidDirection(
        { lastRfidSeenAt: STALE, lastRfidRoomName: "Ward", lastRfidFromRoomName: "ER" },
        NOW,
      ),
    ).toBeNull();
  });

  it("returns null when there is no destination room", () => {
    expect(
      getRfidDirection(
        { lastRfidSeenAt: FRESH, lastRfidRoomName: null, lastRfidFromRoomName: "ER" },
        NOW,
      ),
    ).toBeNull();
  });
});

describe("RfidDirectionLine — exited arrow copy + bidi isolation (he + en)", () => {
  const direction = { kind: "exited", fromRoomName: "ER", toRoomName: "Ward" } as const;

  it("renders the directional arrow copy in Hebrew with both room names", () => {
    refreshTranslations("he");
    const { getByTestId } = render(
      <RfidDirectionLine direction={direction} testId="rfid-dir" />,
    );
    const el = getByTestId("rfid-dir");
    expect(el.textContent).toContain("→");
    expect(el.textContent).toContain("ER");
    expect(el.textContent).toContain("Ward");
  });

  it("renders the directional arrow copy in English with both room names", () => {
    refreshTranslations("en");
    const { getByTestId } = render(
      <RfidDirectionLine direction={direction} testId="rfid-dir" />,
    );
    const el = getByTestId("rfid-dir");
    expect(el.textContent).toContain("→");
    expect(el.textContent).toContain("ER");
    expect(el.textContent).toContain("Ward");
  });

  it("he and en render DISTINCT connective copy (parity, not the same string)", () => {
    refreshTranslations("he");
    const he = render(<RfidDirectionLine direction={direction} testId="rfid-dir" />);
    const heText = he.getByTestId("rfid-dir").textContent ?? "";
    cleanup();
    refreshTranslations("en");
    const en = render(<RfidDirectionLine direction={direction} testId="rfid-dir" />);
    const enText = en.getByTestId("rfid-dir").textContent ?? "";
    expect(heText).not.toBe(enText);
  });

  it("bidi-isolates each room name in a <bdi> so Latin/RTL runs can't reorder", () => {
    const { getByTestId } = render(
      <RfidDirectionLine direction={direction} testId="rfid-dir" />,
    );
    const bdis = getByTestId("rfid-dir").querySelectorAll("bdi");
    const names = Array.from(bdis).map((b) => b.textContent);
    expect(names).toContain("ER");
    expect(names).toContain("Ward");
  });
});

describe("RfidDirectionLine — entered copy (no origin) + bidi isolation (he + en)", () => {
  const direction = { kind: "entered", toRoomName: "Ward" } as const;

  it("renders the entered copy in English with the destination but NO origin arrow-pair", () => {
    refreshTranslations("en");
    const { getByTestId } = render(
      <RfidDirectionLine direction={direction} testId="rfid-dir" />,
    );
    const el = getByTestId("rfid-dir");
    expect(el.textContent).toContain("Entered");
    expect(el.textContent).toContain("Ward");
    // No fabricated origin room and no from→to arrow for an origin-less crossing.
    expect(el.textContent).not.toContain("→");
  });

  it("renders the entered copy in Hebrew with the destination", () => {
    refreshTranslations("he");
    const { getByTestId } = render(
      <RfidDirectionLine direction={direction} testId="rfid-dir" />,
    );
    const el = getByTestId("rfid-dir");
    expect(el.textContent).toContain("נכנס");
    expect(el.textContent).toContain("Ward");
  });

  it("bidi-isolates the destination room name in a <bdi>", () => {
    const { getByTestId } = render(
      <RfidDirectionLine direction={direction} testId="rfid-dir" />,
    );
    const bdis = getByTestId("rfid-dir").querySelectorAll("bdi");
    const names = Array.from(bdis).map((b) => b.textContent);
    expect(names).toContain("Ward");
  });
});
