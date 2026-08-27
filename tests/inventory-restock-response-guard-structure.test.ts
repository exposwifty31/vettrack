/**
 * The NFC fallback scan path cannot be driven in jsdom — it hangs off the Web
 * NFC `NDEFReader`, which does not exist here — so its out-of-order regression
 * is pinned structurally instead of behaviourally. That is a weaker oracle and
 * is stated as such; the behavioural half of the same rule is covered by
 * tests/inventory-restock-stale-response-guard.test.tsx.
 *
 * The rule: a scan response that LOST the race is stale for every consumer, not
 * only for the ones that happen to sit under the guard. It used to be applied
 * to `nfcItemCountsRef` one line ABOVE `claimLatestWrite`, so two fallback
 * scans posting 5 and 6 with the 5 answering last left the cache correctly at 6
 * and the NFC baseline poisoned back to 5 — the next tap then posted 6 again
 * instead of 7. The persist that follows wrote that poisoned map into
 * sessionStorage, so a reload did not clear it either.
 *
 * Checked on the AST rather than the source text: an ordering rule expressed as
 * "this string appears after that string" passes the moment either string is
 * reworded, and the whole point of this file is that a reworded guard is still
 * a guard while a moved statement is a bug.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const FILE = "src/pages/inventory-page.tsx";
const source = readFileSync(resolve(process.cwd(), FILE), "utf8");
const sourceFile = ts.createSourceFile(FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Every node in the tree, parents first. */
function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function containsClaimCall(node: ts.Node): boolean {
  let found = false;
  walk(node, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "claimLatestWrite") {
      found = true;
    }
  });
  return found;
}

/** True when some ancestor is an `if` whose CONDITION calls claimLatestWrite. */
function isUnderClaimGuard(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isIfStatement(p) && containsClaimCall(p.expression)) return true;
  }
  return false;
}

function lineOf(node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

describe(`${FILE} — a superseded scan response reaches no consumer`, () => {
  const observedQuantityReads = (() => {
    const hits: ts.PropertyAccessExpression[] = [];
    walk(sourceFile, (n) => {
      if (
        ts.isPropertyAccessExpression(n) &&
        n.name.text === "observedQuantity" &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "result"
      ) {
        hits.push(n);
      }
    });
    return hits;
  })();

  it("reads the responded quantity at all (the scan would not guard anything otherwise)", () => {
    expect(observedQuantityReads.length).toBeGreaterThan(0);
  });

  it("never reads the responded quantity outside a claimLatestWrite guard", () => {
    const unguarded = observedQuantityReads.filter((n) => !isUnderClaimGuard(n)).map(lineOf);
    expect(unguarded).toEqual([]);
  });

  /** Identifier names appearing in the conditions of every enclosing `if`, up to `stopAt`. */
  function guardNamesAround(node: ts.Node, stopAt: ts.Node): Set<string> {
    const names = new Set<string>();
    for (let p: ts.Node | undefined = node.parent; p && p !== stopAt.parent; p = p.parent) {
      if (!ts.isIfStatement(p)) continue;
      walk(p.expression, (n) => {
        if (ts.isIdentifier(n)) names.add(n.text);
      });
    }
    return names;
  }

  /** The arrow/function bodies passed to `.then(...)` / `.catch(...)` anywhere in the file. */
  const responseHandlers: ts.Node[] = (() => {
    const found: ts.Node[] = [];
    walk(sourceFile, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      const method = n.expression.name.text;
      if (method !== "then" && method !== "catch") return;
      for (const arg of n.arguments) {
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) found.push(arg);
      }
    });
    return found;
  })();

  /** Calls inside a response handler that match `predicate`, with their enclosing guard names. */
  function inHandlers(predicate: (n: ts.CallExpression) => boolean) {
    const hits: { line: number; guards: Set<string> }[] = [];
    for (const handler of responseHandlers) {
      walk(handler, (n) => {
        if (!ts.isCallExpression(n) || !predicate(n)) return;
        hits.push({ line: lineOf(n), guards: guardNamesAround(n, handler) });
      });
    }
    return hits;
  }

  function isMapMutation(n: ts.CallExpression, receiver: string): boolean {
    if (!ts.isPropertyAccessExpression(n.expression)) return false;
    const method = n.expression.name.text;
    if (method !== "set" && method !== "delete") return false;
    return n.expression.expression.getText(sourceFile).startsWith(receiver);
  }

  it("changes the NFC counter from a response handler only when this write still owns the TAG", () => {
    // `claimLatestWrite` answers "has a newer write LANDED". The NFC counter is
    // the baseline for the NEXT request, so it needs the other question. Both
    // sides got this wrong in turn: the failure side restored `prevCount`
    // unconditionally, and the success side sat under `claimLatestWrite` alone,
    // which accepts an earlier response while a newer scan is still pending —
    // scan 5 answers, counter drops back to 5, and a third scan started in that
    // window posts 6 instead of 7.
    const hits = inHandlers((n) => isMapMutation(n, "nfcItemCountsRef.current"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((h) => !h.guards.has("issuedTicketByTagRef")).map((h) => h.line)).toEqual([]);
  });

  it("changes a row's optimistic quantity from a response handler only when no newer write for that ROW was issued", () => {
    // Same rule, different keyspace: the row is keyed by code, and a newer
    // inline edit already issued against it owns what the row shows.
    const hits = inHandlers(
      (n) => ts.isIdentifier(n.expression) && n.expression.text === "setOptimisticActualByCode",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((h) => !h.guards.has("issuedTicketByCodeRef")).map((h) => h.line)).toEqual([]);
  });

  it("persists the NFC counter map only from inside that guard", () => {
    const persists: ts.CallExpression[] = [];
    walk(sourceFile, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : null;
      if (name !== "safeStorageSetItem") return;
      const first = n.arguments[0];
      if (first && ts.isStringLiteral(first) && first.text === "vt_nfc_counts") persists.push(n);
    });

    expect(persists.length).toBe(1);
    expect(persists.filter((n) => !isUnderClaimGuard(n)).map(lineOf)).toEqual([]);
  });
});
