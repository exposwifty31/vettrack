import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import enDict from "../locales/en.json";
import { t } from "../src/lib/i18n";
import { isInternalKey } from "../lib/i18n/internal-keys";

/**
 * CLASS GUARD — "the buildTranslations gotcha".
 *
 * `src/lib/i18n.ts` exports `t` from a hand-written `buildTranslations()` that
 * enumerates every namespace it exposes. `src/lib/i18n.generated.d.ts` is
 * generated straight from the locale JSON, so it happily *types* namespaces
 * that `buildTranslations()` never returns. The result is a namespace that is
 * `undefined` at runtime while `tsc` stays green — TypeScript structurally
 * cannot catch it, because the JSON and the accessor are two independent
 * sources of truth.
 *
 * This test closes that gap: every top-level namespace in `locales/en.json`
 * must either be reachable through `t.*` or be on the explicit server-only
 * allowlist below.
 */

/**
 * Namespaces deliberately NOT exposed on the web client's `t.*`.
 *
 * These are rendered by the SEPARATE server-side i18n path in `lib/i18n/`
 * (`translate()` / `resolveI18nKey()` read the locale JSON directly, so they
 * are unaffected by `buildTranslations()`). Each entry names a live consumer,
 * verified by grep — if a consumer disappears, delete the namespace from both
 * locale files rather than leaving it here.
 */
const SERVER_ONLY_NAMESPACES: ReadonlyArray<readonly [namespace: string, consumer: string]> = [
  ["equipmentMissing", "server/services/equipment-missing-alert.service.ts (equipmentMissing.pushTitle/pushBody)"],
  ["semiDock", "server/lib/semi-dock-notify.ts (semiDock.pushTitle/pushBody)"],
  ["staleCheckout", "server/workers/staleCheckoutSweepWorker.ts (staleCheckout.pushTitle/pushBody)"],
  ["staleReturned", "server/workers/stale-returned-sweep.worker.ts (staleReturned.pushTitle/pushBody)"],
  ["sweepEscalation", "server/workers/sweep-escalation.worker.ts (sweepEscalation.stage{1..4}{Title,Body})"],
  ["shiftImport", "server/routes/shifts.ts (translate(`shiftImport.${key}`))"],
  ["whatsapp", "server/routes/whatsapp.ts (tWhatsApp(locale, `whatsapp.*`))"],
  // Push-notification copy. Distinct from the sibling client namespaces — read
  // by five server consumers: role-notification-scheduler.ts (push.role.*),
  // shift-handover-generator.ts (push.handover.*), notification.worker.ts
  // (push.overdue.*), expiryCheckWorker.ts (push.expiry.*),
  // code-blue-broadcast-push.ts (push.codeBlue.*).
  ["push", "server/lib/role-notification-scheduler.ts + shift-handover-generator.ts + workers/notification.worker.ts + workers/expiryCheckWorker.ts + code-blue-broadcast-push.ts"],
];

const ALLOWLISTED = new Set(SERVER_ONLY_NAMESPACES.map(([ns]) => ns));

const jsonNamespaces = Object.keys(enDict as Record<string, unknown>).filter(
  (ns) => !isInternalKey(ns),
);

/**
 * `accessor[ns] !== undefined` is not a reachability test: `toString`,
 * `constructor`, `valueOf` and `hasOwnProperty` all resolve to functions through
 * Object.prototype, so a namespace with one of those names would pass while
 * being completely unwired. Own-property only.
 */
function isOwn(obj: unknown, key: string): boolean {
  return (
    (typeof obj === "object" || typeof obj === "function") &&
    obj !== null &&
    Object.prototype.hasOwnProperty.call(obj, key)
  );
}

/** Every leaf path in a locale dictionary, `_meta`/internal keys stripped. */
function leafPaths(node: unknown, prefix: string[] = []): string[][] {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return [prefix];
  return Object.keys(node as Record<string, unknown>)
    .filter((key) => !isInternalKey(key))
    .flatMap((key) => leafPaths((node as Record<string, unknown>)[key], [...prefix, key]));
}

/**
 * Does `src` read the dictionary at exactly `d.<dotted>`, as a VALUE rather than
 * as an intermediate hop?
 *
 * The distinction is the whole point. `d.equipmentDetail.toast` appears dozens of
 * times as a prefix of `d.equipmentDetail.toast.returned` — treating that as
 * coverage would mark every sibling leaf reachable, including the unwired
 * `chargeAlertScheduled` that produced one of the three live bugs. So a match
 * only counts when the character after the token is not `.` (i.e. the subtree is
 * being spread or assigned wholesale, which does make every descendant
 * reachable), and the character before is not part of a longer identifier —
 * except for the `...` of a spread.
 */
function readsDictionaryAt(src: string, dotted: string): boolean {
  const token = `d.${dotted}`;
  for (let i = src.indexOf(token); i !== -1; i = src.indexOf(token, i + 1)) {
    const prev = src[i - 1];
    const cleanStart =
      prev === undefined || !/[A-Za-z0-9_$.]/.test(prev) || src.slice(i - 3, i) === "...";
    if (!cleanStart) continue;
    const next = src[i + token.length];
    if (next === undefined || !/[A-Za-z0-9_$.]/.test(next)) return true;
  }
  return false;
}

describe("i18n namespace reachability (locales/en.json ↔ buildTranslations)", () => {
  it("exposes every non-server-only locale namespace on `t.*`", () => {
    const accessor = t as unknown as Record<string, unknown>;
    const unreachable = jsonNamespaces
      .filter((ns) => !ALLOWLISTED.has(ns))
      .filter((ns) => !isOwn(accessor, ns));

    expect(
      unreachable,
      unreachable.length === 0
        ? ""
        : `These locale namespaces are undefined at runtime via t.*: ${unreachable.join(", ")}. ` +
          `Either wire each one into buildTranslations() in src/lib/i18n.ts, delete it from ` +
          `locales/en.json + locales/he.json, or — if it is rendered only by the server-side ` +
          `lib/i18n/ path — add it to SERVER_ONLY_NAMESPACES with its consumer.`,
    ).toEqual([]);
  });

  it("keeps the server-only allowlist honest — every entry still exists in en.json", () => {
    const stale = SERVER_ONLY_NAMESPACES.map(([ns]) => ns).filter(
      (ns) => !jsonNamespaces.includes(ns),
    );
    expect(stale, `Allowlisted namespaces no longer in en.json: ${stale.join(", ")}`).toEqual([]);
  });

  it("does not allowlist a namespace that IS reachable on t.* (allowlist must not over-claim)", () => {
    const accessor = t as unknown as Record<string, unknown>;
    const overClaimed = SERVER_ONLY_NAMESPACES.map(([ns]) => ns).filter((ns) =>
      isOwn(accessor, ns),
    );
    expect(
      overClaimed,
      `Allowlisted as server-only but reachable via t.*: ${overClaimed.join(", ")}`,
    ).toEqual([]);
  });
});


/**
 * CLASS GUARD (leaf level) — the defect the three instance guards below are
 * instances OF.
 *
 * The namespace-level guard above cannot catch them: all three keys live inside
 * namespaces that were already reachable on `t.*`; only the individual leaves
 * were never wired. So this asserts the stronger property — every leaf key that
 * ships in `locales/en.json` is actually read by `buildTranslations()`, either
 * directly (`d.a.b.c`) or through a wholesale spread/assignment of an ancestor
 * (`...d.a` / `a: d.a`).
 *
 * Measured against this commit's parent it reports exactly 74 leaves: the 71 that
 * belonged to the three never-wired dead namespaces, plus the three live bugs.
 * Zero false positives, and zero on the fixed tree.
 */
describe("i18n leaf-key coverage (every locale leaf is read by buildTranslations)", () => {
  it("reads every non-server-only leaf in locales/en.json", () => {
    const source = readFileSync("src/lib/i18n.ts", "utf8").replace(/\s*\.\s*/g, ".");
    const unread = leafPaths(enDict)
      .filter((path) => !ALLOWLISTED.has(path[0]!))
      .filter(
        (path) => !path.some((_, i) => readsDictionaryAt(source, path.slice(0, i + 1).join("."))),
      )
      .map((path) => path.join("."));

    expect(
      unread,
      unread.length === 0
        ? ""
        : `These locale leaf keys are shipped in locales/*.json but never read by ` +
          `buildTranslations() in src/lib/i18n.ts, so no call site can reach them:\n` +
          `${unread.join("\n")}\n` +
          `Wire each one into buildTranslations(), or delete it from BOTH locale files.`,
    ).toEqual([]);
  });
});

/**
 * INSTANCE GUARDS — the three live copy bugs this class of defect produced.
 * Each key exists in both locale files but was never wired, so the call site
 * either hardcoded English or silently dropped the message.
 */
describe("i18n leaf keys that were present in locales but unreachable via t.*", () => {
  it("equipmentDetail.toast.chargeAlertScheduled is callable and interpolates {minutes}", () => {
    expect(typeof t.equipmentDetail.toast.chargeAlertScheduled).toBe("function");
    const rendered = t.equipmentDetail.toast.chargeAlertScheduled(30);
    expect(rendered).toContain("30");
    expect(rendered).not.toContain("{minutes");
  });

  it("myEquipment.toast.chargeAlertScheduled is callable and interpolates {minutes}", () => {
    expect(typeof t.myEquipment.toast.chargeAlertScheduled).toBe("function");
    // `not.toContain("{minutes}")` alone is vacuous here: neither locale template
    // ever contains that literal (HE/EN both use the ICU form `{minutes, plural`).
    // The positive assertion is what makes this test able to fail.
    expect(t.myEquipment.toast.chargeAlertScheduled(45)).toContain("45");
    expect(t.myEquipment.toast.chargeAlertScheduled(1)).toContain("1");
    expect(t.myEquipment.toast.chargeAlertScheduled(45)).not.toContain("{minutes");
  });

  it("equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER is reachable (server throws this 409 code)", () => {
    expect(typeof t.equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER).toBe("string");
    expect(t.equipmentWaitlist.WAITLIST_RESERVATION_HELD_BY_OTHER.length).toBeGreaterThan(0);
  });
});
