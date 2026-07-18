import { describe, expect, it, vi } from "vitest";

import { parseArgs, runCli } from "../src/cli";

describe("parseArgs", () => {
  it("parses space- and equals-separated flags", () => {
    const a = parseArgs(["--adapter", "file", "--file", "reads.ndjson", "--api-origin", "https://a", "--clinic", "c"]);
    expect(a.adapter).toBe("file");
    expect(a.file).toBe("reads.ndjson");
    expect(a.apiOrigin).toBe("https://a");
    expect(a.clinicId).toBe("c");

    const b = parseArgs(["--adapter=synthetic", "--clinic=c2"]);
    expect(b.adapter).toBe("synthetic");
    expect(b.clinicId).toBe("c2");
  });

  it("defaults the secret env var name and never accepts a secret on argv", () => {
    expect(parseArgs(["--adapter", "stdin"]).secretEnv).toBe("RFID_WEBHOOK_SECRET");
    expect(() => parseArgs(["--adapter", "stdin", "--secret", "hunter2"])).toThrow(/argv/i);
    expect(() => parseArgs(["--adapter", "stdin", "--secret=hunter2"])).toThrow(/argv/i);
  });

  it("rejects an unknown adapter", () => {
    expect(() => parseArgs(["--adapter", "zebra"])).toThrow();
  });
});

describe("runCli", () => {
  it("runs the synthetic adapter end-to-end and writes a JSON summary to stdout", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, accepted: 1, updated: 1 }), { status: 202 }),
    ) as unknown as typeof fetch;
    const out: string[] = [];
    const summary = await runCli({
      argv: ["--adapter", "synthetic", "--api-origin", "https://api.test", "--clinic", "clinic-a"],
      env: { RFID_WEBHOOK_SECRET: "s3cr3t" },
      fetchFn,
      stdout: (s) => out.push(s),
    });
    expect(summary.readsProcessed).toBeGreaterThan(0);
    expect(summary.accepted).toBeGreaterThanOrEqual(1);
    expect(fetchFn).toHaveBeenCalled();
    const printed = JSON.parse(out.join(""));
    expect(printed.accepted).toBe(summary.accepted);
  });

  it("throws when the secret env var is missing", async () => {
    await expect(
      runCli({
        argv: ["--adapter", "synthetic", "--api-origin", "https://api.test", "--clinic", "clinic-a"],
        env: {},
        fetchFn: vi.fn() as unknown as typeof fetch,
        stdout: () => {},
      }),
    ).rejects.toThrow();
  });
});
