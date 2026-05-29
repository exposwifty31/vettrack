const ENV_PILOT_MODE = import.meta.env.VITE_PILOT_MODE === "true";

const OVERRIDE_KEY = "vt_pilot_mode_override";

export type PilotModeOverride = boolean | null;

function readOverride(): PilotModeOverride {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(OVERRIDE_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
    return null;
  } catch {
    return null;
  }
}

const initialOverride = readOverride();

export const isPilotMode: boolean = initialOverride ?? ENV_PILOT_MODE;

export const pilotModeEnvDefault: boolean = ENV_PILOT_MODE;

export function getPilotModeOverride(): PilotModeOverride {
  return readOverride();
}

export function setPilotModeOverride(value: PilotModeOverride): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(OVERRIDE_KEY);
    } else {
      window.localStorage.setItem(OVERRIDE_KEY, String(value));
    }
  } catch {
    // localStorage may be unavailable in private browsing
  }
}
