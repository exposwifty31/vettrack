/**
 * Patient / hospitalization types (Slice 6b).
 * Leaf domain module — no imports from ./index.ts.
 */

export interface ActivePatient {
  animalId: string;
  animalName: string;
  species: string | null;
  breed: string | null;
}

export type HospitalizationStatus =
  | "admitted"
  | "observation"
  | "critical"
  | "recovering"
  | "discharged"
  | "deceased";

export interface Animal {
  id: string;
  clinicId: string;
  ownerId: string | null;
  name: string;
  species: string | null;
  recordNumber: string | null;
  breed: string | null;
  sex: string | null;
  color: string | null;
  weightKg: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Owner {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string | null;
  nationalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Hospitalization {
  id: string;
  clinicId: string;
  animalId: string;
  animal: Animal;
  owner: Owner | null;
  admittedAt: string;
  dischargedAt: string | null;
  status: HospitalizationStatus;
  ward: string | null;
  bay: string | null;
  admissionReason: string | null;
  admittingVetId: string | null;
  admittingVetName: string | null;
  dischargeNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmitPatientRequest {
  animalId?: string;
  animalName?: string;
  species?: string;
  breed?: string;
  sex?: string;
  weightKg?: number;
  ownerName?: string;
  ownerPhone?: string;
  admissionReason?: string;
  ward?: string;
  bay?: string;
  admittingVetId?: string;
}

export interface UpdatePatientRequest {
  animalName?: string;
  species?: string | null;
  breed?: string | null;
  sex?: string | null;
  weightKg?: number | null;
  ward?: string | null;
  bay?: string | null;
  admissionReason?: string | null;
  status?: Exclude<HospitalizationStatus, "discharged">;
}

export interface AnimalSearchResult {
  id: string;
  name: string;
  species: string | null;
  breed: string | null;
  ownerName: string | null;
}
