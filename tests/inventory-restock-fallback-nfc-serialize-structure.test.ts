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
