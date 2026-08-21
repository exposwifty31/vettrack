/**
 * A fingerprint of the shared verification engine.
 *
 * WHY THIS EXISTS
 * The engine lives as two copies, one per repository: the RN migration repo
 * carries plain CommonJS modules, and the Capacitor `vettrack` repo carries the
 * same files with a `.cjs` extension because that package is `"type": "module"`.
 * Two copies of a gate is exactly the rot the gate exists to catch: they drift,
 * both stay green, and they are green about different things. Nothing offline
 * can compare a file in another repository.
 *
 * THIS COMMENT IS PART OF THE HASHED SOURCE, so it cannot name one repo's
 * extension as "here" — the port that keeps the copies in step rewrites those,
 * and the sentence would then read as its own opposite in the other repo.
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
 * The internal `require` calls, built FROM `ENGINE_MODULES` rather than from a
 * second hand-kept list. The two lists drifted the moment they existed: the
 * literal alternation omitted `fingerprint` itself, so the day one module
 * requires another the two copies would hash differently while being the same
 * code — identical files, divergent fingerprints, and a gate red about nothing.
 * Longest name first so a shorter one cannot claim a prefix of it.
 */
const MODULE_REQUIRE = new RegExp(
  `require\\("\\./(${[...ENGINE_MODULES]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\-]/g, String.raw`\$&`))
    .join("|")})\\.c?js"\\)`,
  "g",
);

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
    const present = candidates.filter((candidate) => fs.existsSync(candidate));
    if (present.length === 0) throw new Error(`engine module missing: ${name}.{js,cjs} in ${dir}`);
    // TWO COPIES OF ONE MODULE IS THE DRIFT THIS FILE EXISTS TO CATCH, and taking
    // the first match would hash the stale one and leave the live one uncovered —
    // green, about bytes that no longer run. Refuse the ambiguity.
    if (present.length > 1) {
      throw new Error(`engine module ${name} exists as BOTH .js and .cjs in ${dir} — delete the stale copy`);
    }
    const found = present[0];
    files.push(path.basename(found));
    const source = fs
      .readFileSync(found, "utf8")
      // The one sanctioned difference between the copies.
      .replace(MODULE_REQUIRE, 'require("./$1")')
      // Line endings are a checkout setting, not a change to the logic.
      .replaceAll("\r\n", "\n");
    hash.update(name).update(SEPARATOR).update(source);
  }
  return { fingerprint: hash.digest("hex"), files };
}

module.exports = { ENGINE_MODULES, MODULE_REQUIRE, fingerprintEngine };
