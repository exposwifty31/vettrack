/**
 * Fallback NFC scans of the same unresolved tagId used to run concurrently.
 * Each write advanced only `issuedTicketByTagRef`; the item code is unknown
 * until a response lands. An earlier response could therefore pass the
 * code-only `noNewerIssued` guard, set the row (via optimistic state and/or
 * the landed cache patch) to an older quantity while a newer tag write was
 * still pending, and a subsequent relative row control (+1) would submit from
 * that stale baseline — e.g. from 4, issue 5 then 6; 5 returns first; +1
 * submits 6 instead of 7.
 *
 * A tag→code ownership bridge alone cannot close this: the row renders
 * `optimisticActualByCode[code] ?? line.actual`, and `line.actual` is updated
 * by the cache patch ordered by landed ticket. The viable fix is to serialize
 * fallback writes per tagId and compute `prevCount`/`newCount` inside that
 * chain, so a later tap is issued only after the earlier response (and thus
 * after the code is known). Once the tag is resolved, the chain routes through
 * `scanLine`, which bumps the row optimistically at issue time — what a later
 * +1 needs to see.
 *
 * NDEFReader is unavailable in jsdom, so this rule is pinned structurally.
 * Behavioral driving of the Web NFC path is unreachable here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const FILE = "src/pages/inventory-page.tsx";
const source = readFileSync(resolve(process.cwd(), FILE), "utf8");
const sourceFile = ts.createSourceFile(FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function isIdentifierNamed(n: ts.Node, name: string): boolean {
  return ts.isIdentifier(n) && n.text === name;
}

/** The `handleNFCTag` callback body — fallback serialization lives only there. */
function findHandleNfcTagBody(): ts.ConciseBody {
  let body: ts.ConciseBody | undefined;
  walk(sourceFile, (n) => {
    if (!ts.isVariableDeclaration(n)) return;
    if (!isIdentifierNamed(n.name, "handleNFCTag")) return;
    const init = n.initializer;
    if (!init || !ts.isCallExpression(init)) return;
    const arg = init.arguments[0];
    if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
      body = arg.body;
    }
  });
  if (!body) throw new Error("handleNFCTag callback not found");
  return body;
}

function textOf(n: ts.Node): string {
  return n.getText(sourceFile);
}

describe(`${FILE} — fallback NFC writes serialize per tagId`, () => {
  const handleBody = findHandleNfcTagBody();

  it("declares a per-tag promise chain for fallback NFC writes", () => {
    let found = false;
    walk(sourceFile, (n) => {
      if (!ts.isVariableDeclaration(n)) return;
      if (!isIdentifierNamed(n.name, "fallbackNfcChainByTagRef")) return;
      found = true;
    });
    expect(found).toBe(true);
  });

  it("declares a tag→item resolution map so a later chained tap can route through scanLine", () => {
    let found = false;
    walk(sourceFile, (n) => {
      if (!ts.isVariableDeclaration(n)) return;
      if (!isIdentifierNamed(n.name, "nfcTagResolvedItemRef")) return;
      found = true;
    });
    expect(found).toBe(true);
  });

  it("computes prevCount inside the per-tag chain, not before enqueue", () => {
    // The bug: reading/writing the NFC counter at issue time outside the chain
    // lets two taps of one tag race. The fix: `prevCount` is declared inside a
    // `.then` callback that is enqueued via `fallbackNfcChainByTagRef`, and the
    // chain is established before that declaration in source order.
    const prevDecls: ts.VariableDeclaration[] = [];
    walk(handleBody, (n) => {
      if (!ts.isVariableDeclaration(n)) return;
      if (!isIdentifierNamed(n.name, "prevCount")) return;
      prevDecls.push(n);
    });
    expect(prevDecls.length).toBeGreaterThan(0);

    const bodyText = textOf(handleBody);
    const chainIdx = bodyText.indexOf("fallbackNfcChainByTagRef");
    expect(chainIdx).toBeGreaterThanOrEqual(0);

    for (const decl of prevDecls) {
      let inThenCallback = false;
      for (let p: ts.Node | undefined = decl.parent; p; p = p.parent) {
        if (!(ts.isArrowFunction(p) || ts.isFunctionExpression(p))) continue;
        const call = p.parent;
        if (!call || !ts.isCallExpression(call)) continue;
        if (!call.arguments.includes(p as ts.Expression)) continue;
        if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "then") {
          inThenCallback = true;
          break;
        }
      }
      expect(inThenCallback).toBe(true);
      expect(decl.getStart(sourceFile)).toBeGreaterThan(
        handleBody.getStart(sourceFile) + chainIdx,
      );
    }
  });

  /**
   * The chain's DATAFLOW, not its vocabulary.
   *
   * Checking that the file mentions `fallbackNfcChainByTagRef`, declares a
   * `prevCount` inside some `.then`, and calls `.set(tagId, …)` somewhere
   * proves nothing: an implementation can read `.get(tagId)` and ignore the
   * value, build `Promise.resolve().then(…)`, and satisfy all three while
   * same-tag scans still run concurrently. Serialization exists only if the
   * stored chain is DERIVED from the previously stored one.
   *
   * Returns the three links, checked by name binding:
   *   prior   <- fallbackNfcChainByTagRef.current.get(tagId)
   *   chained <- a call chain whose ROOT receiver is `prior`
   *   set(tagId, …) referencing `chained`
   */
  function chainLinks(body: ts.Node) {
    const rootOf = (expr: ts.Node): ts.Node => {
      let e: ts.Node = expr;
      for (;;) {
        if (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e)) { e = e.expression; continue; }
        if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)) { e = e.expression; continue; }
        return e;
      }
    };

    let priorName: string | null = null;
    walk(body, (n) => {
      if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isIdentifier(n.name)) return;
      let readsGet = false;
      walk(n.initializer, (m) => {
        if (!ts.isCallExpression(m) || !ts.isPropertyAccessExpression(m.expression)) return;
        if (m.expression.name.text !== "get") return;
        if (!m.expression.expression.getText().includes("fallbackNfcChainByTagRef")) return;
        if (m.arguments.length !== 1 || m.arguments[0].getText() !== "tagId") return;
        readsGet = true;
      });
      if (readsGet) priorName = n.name.text;
    });

    let chainedName: string | null = null;
    if (priorName) {
      walk(body, (n) => {
        if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isIdentifier(n.name)) return;
        const root = rootOf(n.initializer);
        if (ts.isIdentifier(root) && root.text === priorName) chainedName = n.name.text;
      });
    }

    let storesChained = false;
    if (chainedName) {
      walk(body, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
        if (n.expression.name.text !== "set") return;
        if (!n.expression.expression.getText().includes("fallbackNfcChainByTagRef")) return;
        if (n.arguments.length !== 2 || n.arguments[0].getText() !== "tagId") return;
        let refsChained = false;
        walk(n.arguments[1], (m) => {
          if (ts.isIdentifier(m) && m.text === chainedName) refsChained = true;
        });
        if (refsChained) storesChained = true;
      });
    }

    return { priorName, chainedName, storesChained };
  }

  it("derives the stored chain from the previously stored one", () => {
    const { priorName, chainedName, storesChained } = chainLinks(handleBody);
    expect(priorName).not.toBeNull();
    expect(chainedName).not.toBeNull();
    expect(storesChained).toBe(true);
  });

  it("rejects a chain that reads the prior promise and does not build on it", () => {
    const snippet = (body: string) =>
      chainLinks(
        ts.createSourceFile("snippet.ts", body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
      );

    // The real shape.
    const good = snippet(`
      const prior = fallbackNfcChainByTagRef.current.get(tagId) ?? Promise.resolve();
      const chained = prior.catch(() => {}).then(async () => { doWork(); });
      fallbackNfcChainByTagRef.current.set(tagId, chained.catch(() => {}));
    `);
    expect(good.storesChained).toBe(true);

    // Reads the prior promise, then ignores it — every vocabulary check still
    // passes and same-tag scans stay concurrent. This is the defect.
    const detached = snippet(`
      const prior = fallbackNfcChainByTagRef.current.get(tagId) ?? Promise.resolve();
      const chained = Promise.resolve().then(async () => { doWork(); });
      fallbackNfcChainByTagRef.current.set(tagId, chained.catch(() => {}));
    `);
    expect(detached.priorName).toBe("prior");
    expect(detached.chainedName).toBeNull();
    expect(detached.storesChained).toBe(false);

    // Builds on prior but never stores it, so the NEXT tap chains off nothing.
    const unstored = snippet(`
      const prior = fallbackNfcChainByTagRef.current.get(tagId) ?? Promise.resolve();
      const chained = prior.then(async () => { doWork(); });
      fallbackNfcChainByTagRef.current.set(tagId, Promise.resolve());
    `);
    expect(unstored.chainedName).toBe("chained");
    expect(unstored.storesChained).toBe(false);
  });

  /**
   * A queued callback cannot be cancelled — `fallbackNfcChainByTagRef.clear()`
   * drops map entries, not the `.then`s already attached to them. So a tap
   * queued before the session finished still runs, still holds the old
   * sessionId in its closure, and a response landing either side of the finish
   * can repopulate the counter and the cache; the next queued callback then
   * opens a NEW session and posts into it.
   *
   * The predicate's NAME is derived, not assumed: whatever function compares
   * `sessionGenerationRef.current` against a value captured at enqueue time is
   * the guard, and every issue/apply site must be behind it.
   */
  function sessionGuard(body: ts.Node) {
    // The captured generation: `const X = sessionGenerationRef.current`.
    let capturedName: string | null = null;
    walk(body, (n) => {
      if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isIdentifier(n.name)) return;
      if (n.initializer.getText().replace(/\s+/g, "") === "sessionGenerationRef.current") {
        capturedName = n.name.text;
      }
    });
    if (!capturedName) return { capturedName: null, guardName: null, guardedSites: 0 };

    // The predicate: a function whose body compares the ref to that capture.
    let guardName: string | null = null;
    walk(body, (n) => {
      if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isIdentifier(n.name)) return;
      if (!ts.isArrowFunction(n.initializer) && !ts.isFunctionExpression(n.initializer)) return;
      const t = n.initializer.getText().replace(/\s+/g, "");
      if (t.includes("sessionGenerationRef.current") && t.includes(capturedName as string)) {
        guardName = n.name.text;
      }
    });
    if (!guardName) return { capturedName, guardName: null, guardedSites: 0 };

    // Early returns gated on that predicate.
    let guardedSites = 0;
    walk(body, (n) => {
      if (!ts.isIfStatement(n)) return;
      const cond = n.expression.getText().replace(/\s+/g, "");
      if (!cond.includes(`${guardName}()`)) return;
      const thenText = n.thenStatement.getText().replace(/\s+/g, "");
      if (thenText === "return;" || thenText === "{return;}") guardedSites += 1;
    });
    return { capturedName, guardName, guardedSites };
  }

  it("captures the session generation at enqueue and refuses to issue or apply across a finish", () => {
    const { capturedName, guardName, guardedSites } = sessionGuard(handleBody);
    expect(capturedName).not.toBeNull();
    expect(guardName).not.toBeNull();
    // Three places a stale callback can do damage: before issuing, on success,
    // on failure. All three must bail.
    expect(guardedSites).toBeGreaterThanOrEqual(3);
  });

  it("bumps the session generation wherever the chain map is cleared", () => {
    // Clearing without bumping leaves every queued callback believing it is
    // still current — the map looks reset and nothing actually stopped.
    let bumpedBesideClear = false;
    walk(sourceFile, (n) => {
      if (!ts.isBlock(n)) return;
      const t = n.getText().replace(/\s+/g, "");
      if (!t.includes("fallbackNfcChainByTagRef.current.clear()")) return;
      if (/sessionGenerationRef\.current(\+=1|\+\+|=sessionGenerationRef\.current\+1)/.test(t)) {
        bumpedBesideClear = true;
      }
    });
    expect(bumpedBesideClear).toBe(true);
  });

  it("enqueues fallback work onto fallbackNfcChainByTagRef for the scanned tagId", () => {
    let setsChain = false;
    walk(handleBody, (n) => {
      if (!ts.isCallExpression(n)) return;
      if (!ts.isPropertyAccessExpression(n.expression)) return;
      if (n.expression.name.text !== "set") return;
      if (!textOf(n.expression.expression).includes("fallbackNfcChainByTagRef")) return;
      const args = n.arguments.map((a) => textOf(a));
      if (args[0] === "tagId") setsChain = true;
    });
    expect(setsChain).toBe(true);
  });

  it("stores the resolved item on success so the next chained tap can call scanLine", () => {
    let storesResolved = false;
    let routesViaScanLine = false;
    walk(handleBody, (n) => {
      if (!ts.isCallExpression(n)) return;
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "set") {
        if (textOf(n.expression.expression).includes("nfcTagResolvedItemRef")) {
          storesResolved = true;
        }
      }
      if (ts.isIdentifier(n.expression) && n.expression.text === "scanLine") {
        // scanLine after a resolved-item lookup: the enclosing function body
        // both reads nfcTagResolvedItemRef and calls scanLine.
        for (let p: ts.Node | undefined = n.parent; p && p !== handleBody; p = p.parent) {
          if (!(ts.isArrowFunction(p) || ts.isFunctionExpression(p) || ts.isBlock(p))) continue;
          const scopeText = textOf(p);
          if (
            scopeText.includes("nfcTagResolvedItemRef") &&
            scopeText.includes("scanLine") &&
            (scopeText.includes("resolved") || scopeText.includes(".get(tagId)"))
          ) {
            routesViaScanLine = true;
            break;
          }
        }
      }
    });
    expect(storesResolved).toBe(true);
    expect(routesViaScanLine).toBe(true);
  });
});
