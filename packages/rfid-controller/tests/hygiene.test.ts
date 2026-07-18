import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

function srcFiles(): string[] {
  return readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
}

describe("source hygiene (gate)", () => {
  it("uses no console.log CALLS — structured logging goes through the Logger", () => {
    // Match an actual call (`console.log(`), not prose mentions in doc comments.
    const offenders = srcFiles().filter((f) =>
      /\bconsole\s*\.\s*log\s*\(/.test(readFileSync(join(srcDir, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("ships zero runtime dependencies (no non-node import specifiers in src)", () => {
    const bad: string[] = [];
    for (const f of srcFiles()) {
      const text = readFileSync(join(srcDir, f), "utf8");
      const importRe = /(?:from|import)\s+["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(text))) {
        const spec = m[1];
        const isRelative = spec.startsWith(".") || spec.startsWith("/");
        const isNode = spec.startsWith("node:");
        if (!isRelative && !isNode) bad.push(`${f}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
