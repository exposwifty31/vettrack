/**
 * Acceptable English terms in Hebrew UI context.
 * These are industry-standard medical/technical terms recognised by Israeli
 * veterinary and clinical staff; they must NOT be translated to Hebrew.
 *
 * Before adding a UI string in English, verify it appears here.
 * If it does not, translate it to Hebrew in the relevant locale file.
 */
export const MEDICAL_ENGLISH_WHITELIST = [
  // Medical emergency terms
  "Code Blue",
  "ICU",
  "CPR",
  "CRI",
  "PRN",

  // App / platform names
  "VetTrack",
  "WhatsApp",
  "Dashboard",

  // Technical identifiers
  "QR",
  "API",
  "NFC",

  // Clinical status labels used as proper nouns
  "Status",
  "Alert",
  "Scan",
  "Offline",

  // Vital-signs and ventilator abbreviations always written in English
  "SpO2",
  "EtCO2",
  "FiO2",
  "PEEP",
  "HR",
  "RR",
  "BP",
] as const;

export type MedicalEnglishTerm = (typeof MEDICAL_ENGLISH_WHITELIST)[number];
