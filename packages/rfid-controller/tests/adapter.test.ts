import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { FileAdapter, StdinAdapter, SyntheticAdapter, type RfidRead } from "../src/adapter";

async function collect(adapter: { reads(): AsyncIterable<RfidRead> }): Promise<RfidRead[]> {
  const out: RfidRead[] = [];
  for await (const r of adapter.reads()) out.push(r);
  return out;
}

describe("SyntheticAdapter", () => {
  it("yields the configured reads in order, normalizing readAt to Date", async () => {
    const adapter = new SyntheticAdapter([
      { tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:00:00.000Z" },
      { tagEpc: "E2", gatewayCode: "GW-2", readAt: 1_800_000_000_000 },
      { tagEpc: "E3", gatewayCode: "GW-3", readAt: new Date("2026-07-17T18:00:02.000Z") },
    ]);
    const reads = await collect(adapter);
    expect(reads.map((r) => r.tagEpc)).toEqual(["E1", "E2", "E3"]);
    expect(reads.every((r) => r.readAt instanceof Date && !Number.isNaN(r.readAt.getTime()))).toBe(true);
    expect(reads[0].readAt.toISOString()).toBe("2026-07-17T18:00:00.000Z");
  });

  it("skips reads with an unparseable timestamp rather than yielding NaN dates", async () => {
    const adapter = new SyntheticAdapter([
      { tagEpc: "E1", gatewayCode: "GW-1", readAt: "not-a-date" },
      { tagEpc: "E2", gatewayCode: "GW-1", readAt: "2026-07-17T18:00:00.000Z" },
    ]);
    const reads = await collect(adapter);
    expect(reads.map((r) => r.tagEpc)).toEqual(["E2"]);
  });
});

describe("FileAdapter", () => {
  it("reads NDJSON lines and yields normalized reads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rfid-file-"));
    const file = join(dir, "reads.ndjson");
    writeFileSync(
      file,
      [
        JSON.stringify({ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:00:00.000Z" }),
        "",
        JSON.stringify({ tagEpc: "E2", gatewayCode: "GW-2", readAt: "2026-07-17T18:00:01.000Z" }),
      ].join("\n"),
    );
    const reads = await collect(new FileAdapter(file));
    expect(reads.map((r) => r.tagEpc)).toEqual(["E1", "E2"]);
  });

  it("also accepts a top-level JSON array", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rfid-file-"));
    const file = join(dir, "reads.json");
    writeFileSync(
      file,
      JSON.stringify([
        { tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:00:00.000Z" },
        { tagEpc: "E2", gatewayCode: "GW-2", readAt: "2026-07-17T18:00:01.000Z" },
      ]),
    );
    const reads = await collect(new FileAdapter(file));
    expect(reads).toHaveLength(2);
  });
});

describe("StdinAdapter", () => {
  it("reads NDJSON from the provided stream", async () => {
    const stream = Readable.from([
      `${JSON.stringify({ tagEpc: "E1", gatewayCode: "GW-1", readAt: "2026-07-17T18:00:00.000Z" })}\n`,
      `${JSON.stringify({ tagEpc: "E2", gatewayCode: "GW-2", readAt: "2026-07-17T18:00:01.000Z" })}\n`,
    ]);
    const reads = await collect(new StdinAdapter(stream));
    expect(reads.map((r) => r.tagEpc)).toEqual(["E1", "E2"]);
  });
});
