/**
 * @vitest-environment happy-dom
 *
 * R-M1.4 — Surface RFID direction ("exited ER → Ward") in the locate list and
 * the equipment-detail location card. DISPLAY ONLY: this never mutates custody
 * and never overrides an authoritative room (R-M1.0 precedence). The freshness
 * gate (`RFID_SUBTITLE_MAX_AGE_MS`) is preserved — a stale directional read
 * surfaces nothing.
 *
 * Asserts:
 *  - the pure `getRfidDirection` gate (fresh + a resolvable from→to pair);
 *  - the arrow copy renders in BOTH he and en;
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
import { t, refreshTranslations } from "@/lib/i18n";

const NOW = new Date("2026-07-17T12:00:00.000Z").getTime();
const FRESH = new Date(NOW - 60 * 1000).toISOString(); // 1 min ago
const STALE = new Date(NOW - RFID_SUBTITLE_MAX_AGE_MS - 1000).toISOString();

afterEach(() => {
  cleanup();
  refreshTranslations("he");
});
beforeEach(() => refreshTranslations("he"));

describe("getRfidDirection — freshness + directional gate (R-M1.4, display only)", () => {
  it("returns a from→to pair for a fresh directional read", () => {
    const dir = getRfidDirection(
      {
        lastRfidSeenAt: FRESH,
        lastRfidRoomName: "Ward",
        lastRfidFromRoomName: "ER",
      },
      NOW,
    );
    expect(dir).toEqual({ fromRoomName: "ER", toRoomName: "Ward" });
  });

  it("returns null when the read is stale (freshness gate preserved)", () => {
    expect(
      getRfidDirection(
        { lastRfidSeenAt: STALE, lastRfidRoomName: "Ward", lastRfidFromRoomName: "ER" },
        NOW,
      ),
    ).toBeNull();
  });

  it("returns null when there is no origin room (non-directional / legacy read)", () => {
    expect(
      getRfidDirection(
        { lastRfidSeenAt: FRESH, lastRfidRoomName: "Ward", lastRfidFromRoomName: null },
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

describe("RfidDirectionLine — arrow copy + bidi isolation (he + en)", () => {
  const direction = { fromRoomName: "ER", toRoomName: "Ward" } as const;

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
