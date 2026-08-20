/**
 * A fingerprint of the shared verification engine.
 *
 * WHY THIS EXISTS
 * The engine lives as two copies — this repo carries it as `.js`, the Capacitor
 * `vettrack` repo carries the same files as `.cjs` because that package is
 * `"type": "module"`. Two copies of a gate is exactly the rot the gate exists to
 * catch: they drift, both stay green, and they are green about different things.
 * `env-contract.js` names that failure mode in this repo already ("both halves
 * green while asserting different things"), and nothing offline can compare a
 * file in another repository.
 *
 * WHAT IT CAN AND CANNOT DO
 * It cannot prove the two copies match — that needs both trees at once. What it
 * does is make a change to the engine IMPOSSIBLE TO MAKE QUIETLY: the recorded
 * fingerprint in `verify.config.json` stops matching, the gate fails, and the
 * message names the sibling repo. Updating the recorded value is a deliberate,
 * reviewable line in a diff that says "the shared engine changed" — which is the
 * moment someone has to decide whether the sibling needs the same change.
 *
 * NORMALISATION IS THE POINT
 * The only sanctioned difference between the copies is the module extension in
 * the internal `require` calls. That is normalised away before hashing, so both
 * repos compute the SAME fingerprint from the same logic — and a human comparing
 * one line across the two configs can see at a glance whether they agree.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/**
 * The engine's own modules, in a fixed order. Extension-agnostic, and it hashes
 * ITSELF: a change to the hashing rule is a change to the engine, and leaving it
 * out would let the one module that decides what counts as drift drift freely.
 */
const ENGINE_MODULES = ["claims", "facts", "fingerprint", "git-facts", "run", "scan"];

/**
 * Domain separator between a module name and its source, so two different
 * splits of the same bytes cannot hash alike. Written as an escape rather than
 * a literal: a bare separator character typed into a template literal is how a
 * NUL reached this file, and the sibling module, once each.
 */
const SEPARATOR = "\u0020";

/**
 * Hash the engine as it would read in either repo.
 *
 * @param {string} dir directory holding the engine modules
 * @returns {{ fingerprint: string, files: string[] }}
 */
function fingerprintEngine(dir) {
  const hash = crypto.createHash("sha256");
  const files = [];
  for (const name of ENGINE_MODULES) {
    const candidates = [`${name}.js`, `${name}.cjs`].map((file) => path.join(dir, file));
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) throw new Error(`engine module missing: ${name}.{js,cjs} in ${dir}`);
    files.push(path.basename(found));
    const source = fs
      .readFileSync(found, "utf8")
      // The one sanctioned difference between the copies.
      .replace(/require\("\.\/(claims|facts|git-facts|run|scan)\.c?js"\)/g, 'require("./$1")')
      // Line endings are a checkout setting, not a change to the logic.
      .replace(/\r\n/g, "\n");
    hash.update(name).update(SEPARATOR).update(source);
  }
  return { fingerprint: hash.digest("hex"), files };
}

module.exports = { ENGINE_MODULES, fingerprintEngine };
