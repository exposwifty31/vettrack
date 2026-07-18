/**
 * R-SH-F1.1 — shift-handover artifact contract (patientWorklist).
 *
 * Type + runtime coverage for the PMS-agnostic, discriminated `patientWorklist`
 * union and its persistence serializer:
 *   - `patientWorklist` is a discriminated union keyed on `state`; the `error`
 *     state is distinguishable from `not_configured` AND from a `ready` empty
 *     list — an error can never collapse to "empty".
 *   - the zod serializer REJECTS an unknown `error.code` and STRIPS any unsafe
 *     adapter message/url/credential BEFORE persistence (a TS type alone can't
 *     stop a raw PMS string being written).
 *   - a `ready` entry whose `byTechId` belongs to another clinic is rejected
 *     (never persisted) — `byTechId` is the INTERNAL vt_users.id, validated to
 *     be in the SAME clinic on generate.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import {
  serializePatientWorklist,
  PATIENT_WORKLIST_ERROR_CODES,
  CrossClinicWorklistError,
  type PatientWorklist,
  type PatientWorklistErrorCode,
} from "../server/lib/shift-handover.js";

describe("R-SH-F1.1 — patientWorklist discriminated union", () => {
  it("(type) is a discriminated union keyed on `state`", () => {
    const wl = { state: "not_configured" } as PatientWorklist;
    if (wl.state === "ready") {
      expectTypeOf(wl.entries).toBeArray();
      // @ts-expect-error a ready worklist has no `code`
      void wl.code;
    } else if (wl.state === "error") {
      expectTypeOf(wl.code).toEqualTypeOf<PatientWorklistErrorCode>();
      // @ts-expect-error an error worklist has no `entries`
      void wl.entries;
    }
    // not_configured is a bare discriminator — no entries, no code.
    // @ts-expect-error excess property rejected by the union
    const bad = { state: "not_configured", entries: [] } satisfies PatientWorklist;
    void bad;
  });

  it("error code enum is the closed safe set (no raw PMS message)", () => {
    expect([...PATIENT_WORKLIST_ERROR_CODES].sort()).toEqual([
      "auth_failed",
      "malformed",
      "timeout",
      "unknown",
      "unreachable",
    ]);
  });

  it("error is distinguishable from not_configured AND from a ready empty list", () => {
    const err = serializePatientWorklist({ state: "error", code: "timeout" }, { validTechIds: [] });
    const notConfigured = serializePatientWorklist({ state: "not_configured" }, { validTechIds: [] });
    const readyEmpty = serializePatientWorklist({ state: "ready", entries: [] }, { validTechIds: [] });

    expect(err.state).toBe("error");
    expect(notConfigured.state).toBe("not_configured");
    expect(readyEmpty.state).toBe("ready");
    // an error can never collapse to not_configured or a ready-empty list
    expect(err.state).not.toBe(notConfigured.state);
    expect(err.state).not.toBe(readyEmpty.state);
    expect(readyEmpty.state === "ready" && readyEmpty.entries.length).toBe(0);
  });

  it("rejects an unknown error.code (never persisted as raw)", () => {
    expect(() =>
      serializePatientWorklist({ state: "error", code: "kaboom" }, { validTechIds: [] }),
    ).toThrow();
    expect(() =>
      serializePatientWorklist(
        { state: "error", code: "Internal Server Error: connect ECONNREFUSED" },
        { validTechIds: [] },
      ),
    ).toThrow();
  });

  it("strips any unsafe adapter message/url/credential before persistence", () => {
    const out = serializePatientWorklist(
      {
        state: "error",
        code: "unreachable",
        message: "500 from https://priza.example/api?token=SECRET-TOKEN",
        url: "https://priza.example/api",
        credential: "SECRET-TOKEN",
      },
      { validTechIds: [] },
    );
    expect(out).toEqual({ state: "error", code: "unreachable" });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("SECRET-TOKEN");
    expect(serialized).not.toContain("priza.example");
    expect(serialized).not.toContain("message");
  });

  it("rejects a ready entry whose byTechId belongs to another clinic (never persisted)", () => {
    const input = {
      state: "ready",
      entries: [
        { externalId: "PZ-1", display: "Rex", byTechId: "tech-in-clinic" },
        { externalId: "PZ-2", display: "Milo", byTechId: "tech-OTHER-clinic" },
      ],
    };
    expect(() =>
      serializePatientWorklist(input, { validTechIds: ["tech-in-clinic"] }),
    ).toThrow(CrossClinicWorklistError);
  });

  it("accepts ready entries whose byTechId are all in-clinic and strips unknown entry fields", () => {
    const out = serializePatientWorklist(
      {
        state: "ready",
        entries: [
          { externalId: "PZ-1", display: "Rex", byTechId: "t1", pmsSecret: "leak-me" },
        ],
      },
      { validTechIds: new Set(["t1"]) },
    );
    expect(out.state).toBe("ready");
    if (out.state !== "ready") throw new Error("unreachable");
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toEqual({ externalId: "PZ-1", display: "Rex", byTechId: "t1" });
    expect(JSON.stringify(out)).not.toContain("leak-me");
  });
});
