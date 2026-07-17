#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";

import { FileAdapter, StdinAdapter, SyntheticAdapter, type RawRead, type ReaderAdapter } from "./adapter";
import { loadConfig, loadConfigFromFile, type ControllerConfig } from "./config";
import { RfidController, type RunSummary } from "./controller";
import { createStderrLogger, type Logger } from "./logger";
import { StaticSecretSource } from "./secret-source";
import { HttpSender } from "./sender";

/**
 * Module 10 — CLI (`rfid-controller`). tsx-shebang entry (exports are source
 * `.ts`, no dist). The signing secret is read from an ENV VAR, never from argv,
 * so it can't leak into a process listing or shell history.
 */
export type AdapterKind = "synthetic" | "file" | "stdin";

export interface CliOptions {
  adapter: AdapterKind;
  configFile?: string;
  apiOrigin?: string;
  clinicId?: string;
  controllerVersion?: string;
  secretEnv: string;
  file?: string;
}

const DEFAULT_SECRET_ENV = "RFID_WEBHOOK_SECRET";
const VALID_ADAPTERS: AdapterKind[] = ["synthetic", "file", "stdin"];

/** Parse argv into options. Throws if a raw secret is passed on argv. */
export function parseArgs(argv: string[]): CliOptions {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(token.slice(2), next);
        i += 1;
      } else {
        flags.set(token.slice(2), "true");
      }
    }
  }

  if (flags.has("secret")) {
    throw new Error("refusing to read a secret from argv — set --secret-env <VAR> instead");
  }

  const adapter = (flags.get("adapter") ?? "stdin") as AdapterKind;
  if (!VALID_ADAPTERS.includes(adapter)) {
    throw new Error(`unknown --adapter '${adapter}' (expected ${VALID_ADAPTERS.join("|")})`);
  }

  return {
    adapter,
    configFile: flags.get("config"),
    apiOrigin: flags.get("api-origin"),
    clinicId: flags.get("clinic"),
    controllerVersion: flags.get("controller-version"),
    secretEnv: flags.get("secret-env") ?? DEFAULT_SECRET_ENV,
    file: flags.get("file"),
  };
}

/** Deterministic demo reads for the synthetic adapter (two tags, two crossings). */
function demoReads(): RawRead[] {
  const base = Date.now() - 60_000;
  return [
    { tagEpc: "E280-DEMO-0001", gatewayCode: "GW-ENTRANCE", readAt: new Date(base) },
    { tagEpc: "E280-DEMO-0001", gatewayCode: "GW-ENTRANCE", readAt: new Date(base + 100) },
    { tagEpc: "E280-DEMO-0001", gatewayCode: "GW-WARD-A", readAt: new Date(base + 5_000) },
    { tagEpc: "E280-DEMO-0002", gatewayCode: "GW-ENTRANCE", readAt: new Date(base + 200) },
    { tagEpc: "E280-DEMO-0002", gatewayCode: "GW-THEATRE", readAt: new Date(base + 6_000) },
  ];
}

function buildAdapter(opts: CliOptions): ReaderAdapter {
  switch (opts.adapter) {
    case "synthetic":
      return new SyntheticAdapter(demoReads());
    case "file":
      if (!opts.file) throw new Error("--adapter file requires --file <path>");
      return new FileAdapter(opts.file);
    case "stdin":
      return new StdinAdapter();
  }
}

function resolveConfig(opts: CliOptions): ControllerConfig {
  const base = opts.configFile ? loadConfigFromFile(opts.configFile) : undefined;
  return loadConfig({
    apiOrigin: opts.apiOrigin ?? base?.apiOrigin ?? "",
    clinicId: opts.clinicId ?? base?.clinicId ?? "",
    controllerVersion: opts.controllerVersion ?? base?.controllerVersion,
    debounceMs: base?.debounceMs,
    maxEventsPerBatch: base?.maxEventsPerBatch,
    bufferCap: base?.bufferCap,
    rateLimitPerMinute: base?.rateLimitPerMinute,
  });
}

export interface CliDeps {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  stdout?: (chunk: string) => void;
  logger?: Logger;
}

export async function runCli(deps: CliDeps): Promise<RunSummary> {
  const opts = parseArgs(deps.argv);
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((c: string) => process.stdout.write(c));
  const logger = deps.logger ?? createStderrLogger();

  const config = resolveConfig(opts);

  const secret = (env[opts.secretEnv] ?? "").trim();
  if (!secret) {
    throw new Error(`secret env var ${opts.secretEnv} is missing or empty`);
  }

  const sender = new HttpSender({
    apiOrigin: config.apiOrigin,
    clinicId: config.clinicId,
    bufferCap: config.bufferCap,
    ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    logger,
  });
  const controller = new RfidController({
    config,
    secretSource: new StaticSecretSource(secret),
    sender,
    logger,
  });

  const adapter = buildAdapter(opts);
  const summary = await controller.run(adapter);

  const { outcomes, ...counts } = summary;
  void outcomes;
  stdout(`${JSON.stringify(counts)}\n`);
  return summary;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return typeof entry === "string" && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  runCli({ argv: process.argv.slice(2) })
    .then((summary) => {
      process.exitCode = summary.dropped + summary.stopped > 0 ? 1 : 0;
    })
    .catch((err: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ level: "error", event: "cli_fatal", message: err instanceof Error ? err.message : String(err) })}\n`,
      );
      process.exitCode = 2;
    });
}
