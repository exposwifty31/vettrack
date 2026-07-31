// Barrel for @vettrack/shared — the framework-free shared domain layer consumed by
// server/, src/, and (once published) the external React Native migration repo.
//
// In-repo consumers still import these modules by relative path; this barrel exists so
// an external package consumer can `import { … } from "@vettrack/shared"`. For Metro
// tree-shaking (RN), prefer deep imports (`@vettrack/shared/authority.js`) over the
// barrel — see the migration plan's correction #20.
export * from "./authority.js";
export * from "./code-blue-authority.js";
export * from "./constants.js";
export * from "./doctor-operational-shift.js";
export * from "./emergency-surfaces.manifest.js";
export * from "./equipment-board.js";
export * from "./equipment-readiness-rules.js";
export * from "./equipment-truth.js";
export * from "./equipment-waitlist.js";
export * from "./handoff-debt.js";
export * from "./inventory-console.js";
export * from "./notification-delivery.js";
export * from "./realtime-schema-version.js";
export * from "./rfid-readers.js";
export * from "./webhook-events.js";
export * from "./contracts/asset-copilot.v1.js";
export * from "./contracts/cursor-bug-fixer.v1.js";
