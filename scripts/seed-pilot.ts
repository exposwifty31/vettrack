/**
 * Pilot equipment seed — V1 shortlist (16 items).
 *
 * All usuallyFoundHere values are placeholders based on operational research.
 * Replace with actual locations after the physical seeding walk.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING. Safe to re-run.
 *
 * Usage:
 *   pnpm seed:pilot
 *   tsx scripts/seed-pilot.ts
 */
import "dotenv/config";
import { db, pool, clinics, equipment } from "../server/db.js";

const CLINIC_ID = process.env.DEV_DEFAULT_CLINIC_ID?.trim() || "dev-clinic-default";

const PILOT_EQUIPMENT = [
  {
    id: "pilot-fast-a",
    name: "FAST Ultrasound A",
    searchAlias: "good FAST ultrasound echo machine",
    usuallyFoundHere: "Procedure room — check shelf beside the sink first",
    staffNote: "Update after walk: note which unit has the reliable probe",
  },
  {
    id: "pilot-fast-b",
    name: "FAST Ultrasound B",
    searchAlias: "other FAST ultrasound echo machine",
    usuallyFoundHere: "ICU or procedure room — check both if A is not there",
    staffNote: "Update after walk: note any known probe contact issues",
  },
  {
    id: "pilot-suction-1",
    name: "Portable Suction Unit 1",
    searchAlias: "suction portable suction machine",
    usuallyFoundHere: "Procedure room — right side of equipment wall",
    staffNote: null,
  },
  {
    id: "pilot-suction-2",
    name: "Portable Suction Unit 2",
    searchAlias: "suction portable suction machine",
    usuallyFoundHere: "ICU — may be committed to a vent patient if not on the wall",
    staffNote: null,
  },
  {
    id: "pilot-clippers-1",
    name: "Cordless Clippers 1",
    searchAlias: "clippers shaver cordless",
    usuallyFoundHere: "Treatment room — start at the charging dock",
    staffNote: null,
  },
  {
    id: "pilot-clippers-2",
    name: "Cordless Clippers 2",
    searchAlias: "clippers shaver cordless",
    usuallyFoundHere: "Treatment room or ICU — check near active prep areas",
    staffNote: null,
  },
  {
    id: "pilot-clippers-dock",
    name: "Clipper Charging Dock",
    searchAlias: "clipper charger dock charging station",
    usuallyFoundHere: "Treatment room — fixed location, does not move",
    staffNote: "If dock is empty, clippers are active somewhere nearby",
  },
  {
    id: "pilot-pump-a",
    name: "IV Pump A",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "ICU or ward — may be in isolation bay if not found",
    staffNote: null,
  },
  {
    id: "pilot-pump-b",
    name: "IV Pump B",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Ward or treatment area",
    staffNote: null,
  },
  {
    id: "pilot-pump-c",
    name: "IV Pump C",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Update after walk — tends to drift toward isolation",
    staffNote: "Update after walk: note if this one gets trapped in parvo bay",
  },
  {
    id: "pilot-bp-oscillometric",
    name: "BP Machine (Oscillometric)",
    searchAlias: "blood pressure BP machine oscillometric monitor",
    usuallyFoundHere: "Treatment room — check the equipment shelf",
    staffNote: "Update after walk: note which cuff sizes are with the unit",
  },
  {
    id: "pilot-bp-doppler",
    name: "Doppler BP Unit",
    searchAlias: "doppler blood pressure BP doppler probe",
    usuallyFoundHere: "Treatment room or ICU",
    staffNote: "Probe travels separately from the unit — check both locations",
  },
  {
    id: "pilot-ventilator",
    name: "Ventilator",
    searchAlias: "vent ventilator breathing machine",
    usuallyFoundHere: "ICU — strong anchor, rarely moves far",
    staffNote: null,
  },
  {
    id: "pilot-pulse-ox",
    name: "Pulse Oximeter",
    searchAlias: "pulse ox SpO2 oxygen saturation monitor",
    usuallyFoundHere: "Treatment room or ICU — small, check countertops",
    staffNote: null,
  },
  {
    id: "pilot-warming-unit",
    name: "Warming Unit",
    searchAlias: "warming unit bear hugger warm water pad heat blanket",
    usuallyFoundHere: "Recovery area — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-defibrillator",
    name: "Defibrillator",
    searchAlias: "defibrillator defib AED crash",
    usuallyFoundHere: "Update after walk — should be a fixed anchor location",
    staffNote: null,
  },
] as const;

async function main(): Promise<void> {
  const dbUrl = (process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim();
  if (!dbUrl) {
    console.error("[seed-pilot] DATABASE_URL or POSTGRES_URL is required.");
    process.exit(1);
  }

  console.info(`[seed-pilot] Seeding pilot equipment (clinicId=${CLINIC_ID})…`);

  await db.insert(clinics).values({ id: CLINIC_ID }).onConflictDoNothing();

  for (const item of PILOT_EQUIPMENT) {
    await db
      .insert(equipment)
      .values({
        id: item.id,
        clinicId: CLINIC_ID,
        name: item.name,
        searchAlias: item.searchAlias,
        usuallyFoundHere: item.usuallyFoundHere,
        staffNote: item.staffNote ?? null,
        status: "ok",
      })
      .onConflictDoNothing();

    console.info(`  [ok] ${item.name}`);
  }

  console.info(`[seed-pilot] Done — ${PILOT_EQUIPMENT.length} items seeded.`);
  console.info("");
  console.info("Next step: perform the physical walk and update usuallyFoundHere");
  console.info("values with operational truth from the seeding tech.");
}

main()
  .catch((err) => {
    console.error("[seed-pilot] Failed:", err);
    process.exit(1);
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
