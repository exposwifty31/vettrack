/**
 * Pilot equipment seed — expanded list (~60 items).
 *
 * All usuallyFoundHere values are placeholders based on operational research.
 * Replace with actual locations after the physical seeding walk.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING. Safe to re-run.
 * Existing records are not overwritten — update them manually after the walk.
 *
 * Usage:
 *   pnpm seed:pilot
 *   tsx scripts/seed-pilot.ts
 */
import "dotenv/config";
import { db, pool, clinics, equipment } from "../server/db.js";

const CLINIC_ID = process.env.DEV_DEFAULT_CLINIC_ID?.trim() || "dev-clinic-default";

const PILOT_EQUIPMENT = [
  // ── FAST Ultrasound ───────────────────────────────────────────────────────
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

  // ── Suction ───────────────────────────────────────────────────────────────
  {
    id: "pilot-suction-1",
    name: "Suction Unit — Large",
    searchAlias: "suction big large suction machine",
    usuallyFoundHere: "Procedure room — right side of equipment wall",
    staffNote: null,
  },
  {
    id: "pilot-suction-2",
    name: "Suction Unit — Small",
    searchAlias: "suction small portable suction machine",
    usuallyFoundHere: "ICU — may be committed to a vent patient if not on the wall",
    staffNote: null,
  },

  // ── Clippers (6 units + dock) ─────────────────────────────────────────────
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
    id: "pilot-clippers-3",
    name: "Cordless Clippers 3",
    searchAlias: "clippers shaver cordless",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },
  {
    id: "pilot-clippers-4",
    name: "Cordless Clippers 4",
    searchAlias: "clippers shaver cordless",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },
  {
    id: "pilot-clippers-5",
    name: "Cordless Clippers 5",
    searchAlias: "clippers shaver cordless",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },
  {
    id: "pilot-clippers-6",
    name: "Cordless Clippers 6",
    searchAlias: "clippers shaver cordless",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },
  {
    id: "pilot-clippers-dock",
    name: "Clipper Charging Dock",
    searchAlias: "clipper charger dock charging station",
    usuallyFoundHere: "Treatment room — fixed location, does not move",
    staffNote: "If dock is empty, clippers are active somewhere nearby",
  },

  // ── IV Pumps — 16 representative units from ~50 ───────────────────────────
  {
    id: "pilot-pump-a",
    name: "IV Pump A",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-b",
    name: "IV Pump B",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-c",
    name: "IV Pump C",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-d",
    name: "IV Pump D",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-e",
    name: "IV Pump E",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-f",
    name: "IV Pump F",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Ward — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-g",
    name: "IV Pump G",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Ward — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-h",
    name: "IV Pump H",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Ward — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-i",
    name: "IV Pump I",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Ward — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-j",
    name: "IV Pump J",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Update after walk — tends to drift toward isolation",
    staffNote: "Update after walk: note if this one gets trapped in parvo/isolation bay",
  },
  {
    id: "pilot-pump-k",
    name: "IV Pump K",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Update after walk — tends to drift toward isolation",
    staffNote: null,
  },
  {
    id: "pilot-pump-l",
    name: "IV Pump L",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Update after walk — tends to drift toward isolation",
    staffNote: null,
  },
  {
    id: "pilot-pump-m",
    name: "IV Pump M",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Treatment area — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-n",
    name: "IV Pump N",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Treatment area — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-o",
    name: "IV Pump O",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Treatment area — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-pump-p",
    name: "IV Pump P",
    searchAlias: "pump IV infusion pump drip",
    usuallyFoundHere: "Treatment area — update after walk",
    staffNote: null,
  },

  // ── Syringe Pumps — 10 representative units from 20 ──────────────────────
  {
    id: "pilot-syringe-a",
    name: "Syringe Pump A",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-syringe-b",
    name: "Syringe Pump B",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-syringe-c",
    name: "Syringe Pump C",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-syringe-d",
    name: "Syringe Pump D",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "ICU — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-syringe-e",
    name: "Syringe Pump E",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "Ward — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-syringe-f",
    name: "Syringe Pump F",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "Ward — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-syringe-g",
    name: "Syringe Pump G",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "Ward — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-syringe-h",
    name: "Syringe Pump H",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "Update after walk — check isolation if not found",
    staffNote: "Update after walk: note if this one gets trapped in parvo/isolation bay",
  },
  {
    id: "pilot-syringe-i",
    name: "Syringe Pump I",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "Update after walk — check isolation if not found",
    staffNote: null,
  },
  {
    id: "pilot-syringe-j",
    name: "Syringe Pump J",
    searchAlias: "syringe pump sp pump driver",
    usuallyFoundHere: "Update after walk — check isolation if not found",
    staffNote: null,
  },

  // ── BP Machines ───────────────────────────────────────────────────────────
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

  // ── Multi-Parameter Monitors ──────────────────────────────────────────────
  {
    id: "pilot-monitor-fixed-1",
    name: "Patient Monitor 1 (Fixed)",
    searchAlias: "monitor patient monitor vital signs ECG SpO2 ETCO2",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-monitor-fixed-2",
    name: "Patient Monitor 2 (Fixed)",
    searchAlias: "monitor patient monitor vital signs ECG SpO2 ETCO2",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-monitor-fixed-3",
    name: "Patient Monitor 3 (Fixed)",
    searchAlias: "monitor patient monitor vital signs ECG SpO2 ETCO2",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-monitor-fixed-4",
    name: "Patient Monitor 4 (Fixed)",
    searchAlias: "monitor patient monitor vital signs ECG SpO2 ETCO2",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-monitor-portable-a",
    name: "Patient Monitor Portable A",
    searchAlias: "portable monitor patient monitor vital signs ECG SpO2 ETCO2",
    usuallyFoundHere: "ICU or treatment area — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-monitor-portable-b",
    name: "Patient Monitor Portable B",
    searchAlias: "portable monitor patient monitor vital signs ECG SpO2 ETCO2",
    usuallyFoundHere: "ICU or treatment area — update after walk",
    staffNote: null,
  },

  // ── Ventilator ────────────────────────────────────────────────────────────
  {
    id: "pilot-ventilator",
    name: "Ventilator",
    searchAlias: "vent ventilator breathing machine",
    usuallyFoundHere: "ICU — strong anchor, rarely moves far",
    staffNote: null,
  },

  // ── Oxygen Equipment ──────────────────────────────────────────────────────
  {
    id: "pilot-o2-cage-1",
    name: "Oxygen Cage 1",
    searchAlias: "oxygen cage O2 cage kennel",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-o2-cage-2",
    name: "Oxygen Cage 2",
    searchAlias: "oxygen cage O2 cage kennel",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-o2-cage-3",
    name: "Oxygen Cage 3",
    searchAlias: "oxygen cage O2 cage kennel",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-o2-cage-4",
    name: "Oxygen Cage 4",
    searchAlias: "oxygen cage O2 cage kennel",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },
  {
    id: "pilot-o2-large-animal",
    name: "Oxygen Unit — Large Animals",
    searchAlias: "oxygen O2 unit large animal mobile",
    usuallyFoundHere: "Update after walk — mobile unit",
    staffNote: null,
  },
  {
    id: "pilot-o2-puppy-a",
    name: "Oxygen Unit — Puppy/Litter A",
    searchAlias: "oxygen O2 puppy litter neonatal incubator",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },
  {
    id: "pilot-o2-puppy-b",
    name: "Oxygen Unit — Puppy/Litter B",
    searchAlias: "oxygen O2 puppy litter neonatal incubator",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },

  // ── ECG ───────────────────────────────────────────────────────────────────
  {
    id: "pilot-ecg",
    name: "Portable ECG Unit",
    searchAlias: "ECG EKG electrocardiograph heart monitor",
    usuallyFoundHere: "Update after walk — moves between procedure areas",
    staffNote: null,
  },

  // ── Nebulizer ─────────────────────────────────────────────────────────────
  {
    id: "pilot-nebulizer-1",
    name: "Nebulizer 1",
    searchAlias: "nebulizer nebuliser aerosol inhaler",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },
  {
    id: "pilot-nebulizer-2",
    name: "Nebulizer 2",
    searchAlias: "nebulizer nebuliser aerosol inhaler",
    usuallyFoundHere: "Update after walk",
    staffNote: null,
  },

  // ── Warming / Incubator ───────────────────────────────────────────────────
  {
    id: "pilot-warming-unit",
    name: "Warming Unit",
    searchAlias: "warming unit bear hugger warm water pad heat blanket",
    usuallyFoundHere: "Recovery area — update after walk",
    staffNote: null,
  },
  {
    id: "pilot-incubator",
    name: "Incubator",
    searchAlias: "incubator neonatal puppy warmer",
    usuallyFoundHere: "Update after walk — fixed location",
    staffNote: null,
  },

  // ── Pulse Oximeter ────────────────────────────────────────────────────────
  {
    id: "pilot-pulse-ox",
    name: "Pulse Oximeter",
    searchAlias: "pulse ox SpO2 oxygen saturation monitor",
    usuallyFoundHere: "Treatment room or ICU — small, check countertops",
    staffNote: null,
  },

  // ── Defibrillator ─────────────────────────────────────────────────────────
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
