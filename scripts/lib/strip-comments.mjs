/**
 * Source with comments removed, by a single-pass scanner rather than regexes.
 *
 * Regex layering does not survive this file set, and both failures were silent:
 *
 *   - blocks-then-lines: a LINE comment may legally contain `/*`
 *     (`server/app/routes.ts` says "copilot nested routes (/:id/copilot/…)"),
 *     which opened a block that swallowed every `app.use` below it — 57 mounts
 *     became 15.
 *   - lines-then-blocks: dropping every line whose trim starts with `*` removes
 *     a JSDoc's CLOSING `*​/` while leaving its opening `/**`, so each docblock
 *     then ran on and ate the `router.get` beneath it — 292 routes became 287.
 *
 * Neither reported anything. A shorter manifest is exactly what the generator's
 * orphan invariant exists to prevent, so this has to be correct rather than
 * approximately correct. It tracks the three things a `/` can belong to besides
 * a comment: a string, a template literal, and a REGEX LITERAL.
 *
 * The last is not theoretical. A legal `/[/*]/` in a route file made the walk
 * lose that whole file; in a file with no mount-function call it would have lost
 * only the routes BELOW it, which no check would have noticed.
 *
 * Regex detection is the standard heuristic, stated as such: a `/` opens a
 * literal unless the previous significant token could END an expression (an
 * identifier, a number, a closing bracket), with the usual keyword exceptions
 * where an identifier-shaped token still precedes one. This is not a JS parser,
 * and the generator's loud checks — "no routes extracted from X" and the orphan
 * invariant — remain the backstop for whatever it gets wrong.
 */
const EXPRESSION_END = /[\w$)\]]/;

/** Identifier-shaped tokens after which a `/` still begins a regex, not division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await",
]);

function opensRegex(emitted) {
  const trimmed = emitted.replace(/\s+$/, "");
  if (trimmed === "") return true;
  if (!EXPRESSION_END.test(trimmed[trimmed.length - 1])) return true;
  const word = /[\w$]+$/.exec(trimmed);
  return word ? REGEX_PRECEDING_KEYWORDS.has(word[0]) : false;
}
export function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "/" && opensRegex(out)) {
      out += c;
      i += 1;
      let inClass = false;
      while (i < n && source[i] !== "\n") {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        out += source[i];
        // A `/` inside a character class is literal — `/[/*]/` is ONE regex, and
        // reading its first `/` as the terminator is what lost a whole file.
        if (source[i] === "/" && !inClass) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

