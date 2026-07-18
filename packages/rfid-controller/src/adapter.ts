import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

/**
 * Module 1 — the `ReaderAdapter` seam.
 *
 * A read is the raw, vendor-neutral observation a reader-side adapter produces:
 * a tag seen at a gateway at a time. Per ADR-006 the per-vendor translation
 * (LLRP / vendor-JSON → this shape) lives reader-side and is DEFERRED to the
 * hardware track — this package ships only the Synthetic/File/Stdin adapters
 * used to exercise the pipeline without hardware.
 */
export interface RfidRead {
  tagEpc: string;
  gatewayCode: string;
  /** Canonical internal timestamp; serialized to an RFC-3339 `Z` string only at the envelope boundary. */
  readAt: Date;
}

export interface ReaderAdapter {
  reads(): AsyncIterable<RfidRead>;
}

/** A read as it arrives before timestamp normalization (Date | ISO string | epoch ms). */
export interface RawRead {
  tagEpc: string;
  gatewayCode: string;
  readAt: Date | string | number;
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalize a raw read; returns null if the shape or timestamp is unusable. */
export function normalizeRead(raw: unknown): RfidRead | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.tagEpc !== "string" || r.tagEpc.length === 0) return null;
  if (typeof r.gatewayCode !== "string" || r.gatewayCode.length === 0) return null;
  if (
    !(r.readAt instanceof Date) &&
    typeof r.readAt !== "string" &&
    typeof r.readAt !== "number"
  ) {
    return null;
  }
  const readAt = toDate(r.readAt);
  if (!readAt) return null;
  return { tagEpc: r.tagEpc, gatewayCode: r.gatewayCode, readAt };
}

/** In-memory adapter — replays a fixed list of reads. Drives unit tests + e2e. */
export class SyntheticAdapter implements ReaderAdapter {
  private readonly raw: RawRead[];

  constructor(reads: RawRead[]) {
    this.raw = reads;
  }

  async *reads(): AsyncIterable<RfidRead> {
    for (const item of this.raw) {
      const norm = normalizeRead(item);
      if (norm) yield norm;
    }
  }
}

async function* readNdjson(stream: Readable): AsyncIterable<RfidRead> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let buffered: string[] = [];
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    buffered.push(line);
  }
  // Support either NDJSON (one object per line) or a single top-level JSON array.
  const joined = buffered.join("\n");
  const asArray = tryParseArray(joined);
  if (asArray) {
    for (const item of asArray) {
      const norm = normalizeRead(item);
      if (norm) yield norm;
    }
    return;
  }
  for (const line of buffered) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const norm = normalizeRead(parsed);
    if (norm) yield norm;
  }
}

function tryParseArray(text: string): unknown[] | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** File adapter — NDJSON lines or a single top-level JSON array of reads. */
export class FileAdapter implements ReaderAdapter {
  constructor(private readonly path: string) {}

  reads(): AsyncIterable<RfidRead> {
    return readNdjson(createReadStream(this.path, { encoding: "utf8" }));
  }
}

/** Stdin adapter — NDJSON from `process.stdin` (or an injected stream in tests). */
export class StdinAdapter implements ReaderAdapter {
  constructor(private readonly stream: Readable = process.stdin) {}

  reads(): AsyncIterable<RfidRead> {
    return readNdjson(this.stream);
  }
}
