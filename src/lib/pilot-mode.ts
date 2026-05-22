export const isPilotMode = import.meta.env.VITE_PILOT_MODE === "true";
// temporary build-path diagnostic — remove after confirming pilot mode activates
console.info("[pilot-mode] VITE_PILOT_MODE =", import.meta.env.VITE_PILOT_MODE, "| isPilotMode =", isPilotMode);
