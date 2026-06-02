/** Minimal hospitalization status union (display / ER); patient CRUD removed. */
export type HospitalizationStatus =
  | "admitted"
  | "observation"
  | "critical"
  | "recovering"
  | "discharged"
  | "deceased";
