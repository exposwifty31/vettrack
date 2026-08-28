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

/**
 * The operands that must ALL hold for a condition to be true — the condition
 * flattened on `&&`, with anything else (a `||`, a `!`, a call) left opaque.
 *
 * Without this, a guard only had to APPEAR in the condition, so
 * `if (allowStale || noNewerIssued(...))` passed while permitting exactly the
 * stale mutation the suite exists to forbid. Presence is not a guarantee; a
 * mandatory conjunct is.
 */
function mandatoryConjuncts(expr: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(expr)) return mandatoryConjuncts(expr.expression);
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return [...mandatoryConjuncts(expr.left), ...mandatoryConjuncts(expr.right)];
  }
  return [expr];
}

/**
 * Exactly `claimLatestWrite(<key>, writeTicket)`, positive — `!claim(...)` is a
 * PrefixUnary and does not match. Operands are read, not just the callee: a
 * claim on some OTHER row's code, or on a ticket that is not this write's,
 * proves nothing about THIS response's landed-ness — the same rule
 * `isOwnershipCall` already enforces for `noNewerIssued`.
 */
function isClaimCall(expr: ts.Expression, key: string): boolean {
  const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
  if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression) || e.expression.text !== "claimLatestWrite") {
    return false;
  }
  if (e.arguments.length !== 2) return false;
  const args = e.arguments.map((a) => a.getText());
  return args[0] === key && args[1] === "writeTicket";
}

/**
 * True when the node sits in the THEN branch of an `if` whose condition makes a
 * positive `claimLatestWrite(...)` call mandatory. Ancestry alone is not
 * control flow: the ELSE branch of that very `if` runs exactly when the claim
 * is FALSE, and a negated condition inverts the branches — both used to pass.
 */
function isUnderClaimGuard(node: ts.Node, key: string): boolean {
  let child: ts.Node = node;
  for (let p: ts.Node | undefined = node.parent; p; child = p, p = p.parent) {
    if (!ts.isIfStatement(p)) continue;
    if (child !== p.thenStatement) continue;
    if (mandatoryConjuncts(p.expression).some((c) => isClaimCall(c, key))) return true;
  }
  return false;
}

/** Exactly `noNewerIssued(<ref>.current, <key>, writeTicket)` — receiver, key and ticket. */
function isOwnershipCall(node: ts.Node, ref: string, key: string): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "noNewerIssued") return false;
  if (node.arguments.length !== 3) return false;
  const args = node.arguments.map((a) => a.getText());
  return args[0] === `${ref}.current` && args[1] === key && args[2] === "writeTicket";
}

/**
 * True when the node sits in the THEN branch of some enclosing `if` (up to
 * `stopAt`) that makes the FULL ownership predicate —
 * `noNewerIssued(<ref>.current, <key>, writeTicket)` — a mandatory conjunct.
 *
 * Naming the ref is not enough. `if (issuedTicketByTagRef.current)` mentions
 * it and verifies nothing. Ancestry is not enough either: the ELSE branch of
 * the guarding `if` runs exactly when the predicate is FALSE. So it reads the
 * call, not the identifiers in it, and the branch, not the ancestry.
 */
function hasOwnershipGuard(node: ts.Node, stopAt: ts.Node, ref: string, key: string): boolean {
  let child: ts.Node = node;
  for (let p: ts.Node | undefined = node.parent; p && p !== stopAt.parent; child = p, p = p.parent) {
    if (!ts.isIfStatement(p)) continue;
    // Only the THEN branch runs with the predicate TRUE. The ELSE branch is
    // the predicate's false side, and the condition itself decides nothing.
    if (child !== p.thenStatement) continue;
    if (mandatoryConjuncts(p.expression).some((c) => isOwnershipCall(c, ref, key))) return true;
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
    const unguarded = observedQuantityReads.filter((n) => !isUnderClaimGuard(n, "result.item.code")).map(lineOf);
    expect(unguarded).toEqual([]);
  });

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

  /** Calls inside a response handler that match `predicate`, each able to report its guard. */
  function inHandlers(predicate: (n: ts.CallExpression) => boolean) {
    const hits: { line: number; guarded: (ref: string, key: string) => boolean }[] = [];
    for (const handler of responseHandlers) {
      walk(handler, (n) => {
        if (!ts.isCallExpression(n) || !predicate(n)) return;
        hits.push({
          line: lineOf(n),
          guarded: (ref: string, key: string) => hasOwnershipGuard(n, handler, ref, key),
        });
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

  /** Does `if (<cond>) { nfcItemCountsRef.current.set(tagId, 1) }` count as guarded? */
  function conditionAccepts(cond: string): boolean {
    const snippet = ts.createSourceFile(
      "snippet.ts",
      `if (${cond}) { nfcItemCountsRef.current.set(tagId, 1); }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let target: ts.Node | undefined;
    walk(snippet, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      if (n.expression.name.text !== "set") return;
      if (!n.expression.expression.getText().startsWith("nfcItemCountsRef.current")) return;
      target = n;
    });
    if (!target) throw new Error("snippet built no mutation to test");
    return hasOwnershipGuard(target, snippet, "issuedTicketByTagRef", "tagId");
  }

  /** Same oracle, but the caller writes the WHOLE statement — branch placement included. */
  function statementAccepts(statement: string): boolean {
    const snippet = ts.createSourceFile("snippet.ts", statement, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let target: ts.Node | undefined;
    walk(snippet, (n) => {
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
      if (n.expression.name.text !== "set") return;
      if (!n.expression.expression.getText().startsWith("nfcItemCountsRef.current")) return;
      target = n;
    });
    if (!target) throw new Error("snippet built no mutation to test");
    return hasOwnershipGuard(target, snippet, "issuedTicketByTagRef", "tagId");
  }

  it("accepts the ownership predicate only where it is MANDATORY, not merely present", () => {
    const GUARD = "noNewerIssued(issuedTicketByTagRef.current, tagId, writeTicket)";

    // Accepted: the predicate must hold for the branch to run.
    expect(conditionAccepts(GUARD)).toBe(true);
    expect(conditionAccepts(`sessionIdRef.current && ${GUARD}`)).toBe(true);
    expect(conditionAccepts(`(${GUARD}) && sessionIdRef.current`)).toBe(true);

    // Rejected: each of these lets the mutation run on a stale response.
    expect(conditionAccepts(`allowStale || ${GUARD}`)).toBe(false);
    expect(conditionAccepts(`!${GUARD}`)).toBe(false);
    expect(conditionAccepts(`allowStale || (sessionIdRef.current && ${GUARD})`)).toBe(false);

    // Rejected: right shape, wrong operands — the reason the call is read
    // rather than the identifiers in it.
    expect(conditionAccepts("noNewerIssued(issuedTicketByCodeRef.current, tagId, writeTicket)")).toBe(false);
    expect(conditionAccepts("noNewerIssued(issuedTicketByTagRef.current, code, writeTicket)")).toBe(false);
    expect(conditionAccepts("noNewerIssued(issuedTicketByTagRef.current, tagId, 0)")).toBe(false);
  });

  it("rejects the ownership predicate when the mutation sits in the ELSE branch", () => {
    // The else branch runs exactly when the predicate is FALSE — the mutation
    // there is the stale write the guard exists to forbid, and an ancestry
    // check that ignores which branch it ascended through calls it guarded.
    const GUARD = "noNewerIssued(issuedTicketByTagRef.current, tagId, writeTicket)";
    expect(statementAccepts(`if (${GUARD}) { keep(); } else { nfcItemCountsRef.current.set(tagId, 1); }`)).toBe(false);
    // Positive control: the same statement with the mutation in the THEN branch.
    expect(statementAccepts(`if (${GUARD}) { nfcItemCountsRef.current.set(tagId, 1); } else { keep(); }`)).toBe(true);
  });

  it("changes the NFC counter from a response handler only when this write still owns the TAG", () => {
    // `claimLatestWrite` answers "has a newer write LANDED". The NFC counter is
    // the baseline for the NEXT request, so it needs the other question. Both
    // sides got this wrong in turn: the failure side restored `prevCount`
    // unconditionally, and the success side sat under `claimLatestWrite` alone,
    // which accepts an earlier response while a newer scan is still pending —
    // scan 5 answers, counter drops back to 5, and a third scan started in that
    // window posts 6 instead of 7.
    //
    // The per-tag fallback chain also bumps the counter to `newCount` at issue
    // time inside its `.then` — that is not a response mutation and must not
    // be mistaken for one.
    const hits = inHandlers((n) => {
      if (!isMapMutation(n, "nfcItemCountsRef.current")) return false;
      if (
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "set" &&
        n.arguments.length >= 2 &&
        n.arguments[1].getText(sourceFile) === "newCount"
      ) {
        return false;
      }
      return true;
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.filter((h) => !h.guarded("issuedTicketByTagRef", "tagId")).map((h) => h.line)).toEqual([]);
  });

  it("changes a row's optimistic quantity from a response handler only when no newer write for that ROW was issued", () => {
    // Same rule, different keyspace: the row is keyed by code, and a newer
    // inline edit already issued against it owns what the row shows.
    const hits = inHandlers(
      (n) => ts.isIdentifier(n.expression) && n.expression.text === "setOptimisticActualByCode",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.filter((h) => !h.guarded("issuedTicketByCodeRef", "result.item.code")).map((h) => h.line),
    ).toEqual([]);
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
    expect(persists.filter((n) => !isUnderClaimGuard(n, "result.item.code")).map(lineOf)).toEqual([]);
  });
});

/**
 * Negative coverage for the ownership-predicate checker itself. The production
 * assertions above only fail when the live page regresses; these snippets prove
 * the checker rejects the incomplete forms CodeRabbit named — a condition that
 * merely mentions the ref, and a `noNewerIssued` call with the wrong ticket.
 */
describe("ownership predicate checker rejects incomplete guards", () => {
  function parseSnippet(snippet: string): ts.SourceFile {
    return ts.createSourceFile("snippet.tsx", snippet, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  }

  function mutationGuarded(
    snippet: string,
    mutationName: string,
    ref: string,
    key: string,
  ): boolean {
    // Delegates to the ONE real checker. A private loose copy here is how a
    // checker and its negative-proof drift apart — the proof keeps passing
    // against the copy while the checker it vouches for has moved on.
    const sf = parseSnippet(snippet);
    let mutation: ts.CallExpression | undefined;
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      if (ts.isIdentifier(n.expression) && n.expression.text === mutationName) {
        mutation = n;
      }
    });
    if (!mutation) throw new Error(`mutation ${mutationName} not found in snippet`);
    return hasOwnershipGuard(mutation, sf, ref, key);
  }

  it("rejects a condition that only names the ticket map", () => {
    const weak = `
      .then((result) => {
        if (issuedTicketByCodeRef.current) {
          setOptimisticActualByCode((prev) => ({ ...prev, [result.item.code]: result.observedQuantity }));
        }
      })
    `;
    expect(mutationGuarded(weak, "setOptimisticActualByCode", "issuedTicketByCodeRef", "result.item.code")).toBe(
      false,
    );
  });

  it("rejects a noNewerIssued call that does not validate writeTicket", () => {
    const wrongTicket = `
      .then((result) => {
        if (noNewerIssued(issuedTicketByCodeRef.current, result.item.code, 0)) {
          setOptimisticActualByCode((prev) => ({ ...prev, [result.item.code]: result.observedQuantity }));
        }
      })
    `;
    expect(
      mutationGuarded(wrongTicket, "setOptimisticActualByCode", "issuedTicketByCodeRef", "result.item.code"),
    ).toBe(false);
  });

  it("accepts the full ownership predicate", () => {
    const full = `
      .then((result) => {
        if (noNewerIssued(issuedTicketByCodeRef.current, result.item.code, writeTicket)) {
          setOptimisticActualByCode((prev) => ({ ...prev, [result.item.code]: result.observedQuantity }));
        }
      })
    `;
    expect(mutationGuarded(full, "setOptimisticActualByCode", "issuedTicketByCodeRef", "result.item.code")).toBe(
      true,
    );
  });
});

/**
 * Negative coverage for the claim-guard checker itself: `isUnderClaimGuard`
 * must read control flow, not ancestry. A persist in the ELSE branch runs when
 * the claim is FALSE, and a persist under `!claimLatestWrite(...)` runs only
 * on the losing side — both are exactly the stale writes the suite forbids.
 */
describe("claim guard checker rejects inverted control flow", () => {
  function persistGuarded(statement: string): boolean {
    const sf = ts.createSourceFile("snippet.ts", statement, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let persist: ts.Node | undefined;
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      if (ts.isIdentifier(n.expression) && n.expression.text === "safeStorageSetItem") persist = n;
    });
    if (!persist) throw new Error("snippet built no persist to test");
    return isUnderClaimGuard(persist, "result.item.code");
  }

  it("accepts a persist in the THEN branch of a positive claim", () => {
    expect(persistGuarded(`if (claimLatestWrite(result.item.code, writeTicket)) { safeStorageSetItem("k", v); }`)).toBe(true);
  });

  it("rejects a persist in the ELSE branch", () => {
    expect(persistGuarded(`if (claimLatestWrite(result.item.code, writeTicket)) { keep(); } else { safeStorageSetItem("k", v); }`)).toBe(false);
  });

  it("rejects a persist under a NEGATED claim", () => {
    expect(persistGuarded(`if (!claimLatestWrite(result.item.code, writeTicket)) { safeStorageSetItem("k", v); }`)).toBe(false);
  });

  it("rejects a claim with the wrong ticket — landed-ness of some OTHER write proves nothing", () => {
    expect(persistGuarded(`if (claimLatestWrite(result.item.code, 0)) { safeStorageSetItem("k", v); }`)).toBe(false);
    expect(persistGuarded(`if (claimLatestWrite(result.item.code, otherTicket)) { safeStorageSetItem("k", v); }`)).toBe(false);
  });

  it("rejects a claim keyed by the wrong code — this row's landed-ness, not a neighbour's", () => {
    expect(persistGuarded(`if (claimLatestWrite(someOtherCode, writeTicket)) { safeStorageSetItem("k", v); }`)).toBe(false);
  });
});
