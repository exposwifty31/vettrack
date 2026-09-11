/**
 * Entry point for `pnpm worker`. Deliberately tiny: ESM evaluates every static import
 * before the first statement runs, so a gate placed after `import "../db.js"` would run
 * only after the Pool (and every other import-time side effect) already existed. The
 * worker body therefore lives in ./notification.worker.main.ts and is loaded only once
 * the environment has been validated.
 */
import "../lib/env-bootstrap.js";
import { validateWorkerEnv } from "../lib/envValidation.js";

validateWorkerEnv();

import("./notification.worker.main.js").catch((err) => {
  console.error("[worker] fatal: failed to load worker body", err);
  process.exit(1);
});
