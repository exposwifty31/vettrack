/**
 * Query performance monitoring for Drizzle/Postgres.
 * - Tracks slow queries (> threshold_ms)
 * - Reports query counts, durations, and error rates
 * - Integrates with Sentry for alerting
 */
import { incrementMetric } from "./metrics.js";

interface QueryMetrics {
  totalQueries: number;
  totalDurationMs: number;
  slowQueries: number;
  errorQueries: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  maxDurationMs: number;
}

interface SlowQuery {
  sql: string;
  durationMs: number;
  timestamp: Date;
  error?: string;
}

const SLOW_QUERY_THRESHOLD_MS = 1000; // Alert on queries > 1s
const MAX_SLOW_QUERIES_TRACKED = 100; // Keep last 100 slow queries in memory
const DURATIONS_SAMPLE_SIZE = 1000; // Track last 1000 query durations for percentiles

let queryDurations: number[] = [];
let slowQueriesLog: SlowQuery[] = [];
let totalQueriesExecuted = 0;
let totalErrorQueries = 0;

export function recordQueryDuration(sql: string, durationMs: number, error?: Error): void {\n  totalQueriesExecuted++;\n  queryDurations.push(durationMs);\n  \n  // Keep sample size bounded\n  if (queryDurations.length > DURATIONS_SAMPLE_SIZE) {\n    queryDurations = queryDurations.slice(-DURATIONS_SAMPLE_SIZE);\n  }\n  \n  if (error) {\n    totalErrorQueries++;\n    incrementMetric(\"db_query_error\");\n  }\n  \n  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {\n    incrementMetric(\"db_slow_query\");\n    slowQueriesLog.push({\n      sql: truncateSql(sql),\n      durationMs,\n      timestamp: new Date(),\n      error: error?.message,\n    });\n    \n    // Keep log bounded\n    if (slowQueriesLog.length > MAX_SLOW_QUERIES_TRACKED) {\n      slowQueriesLog = slowQueriesLog.slice(-MAX_SLOW_QUERIES_TRACKED);\n    }\n    \n    // Log to console in non-production for visibility\n    if (process.env.NODE_ENV !== \"production\") {\n      console.warn(`[db] SLOW_QUERY (${durationMs}ms): ${truncateSql(sql, 80)}`);\n    }\n  }\n}\n\nfunction truncateSql(sql: string, maxLen: number = 200): string {\n  return sql.length > maxLen ? sql.substring(0, maxLen) + \"...\" : sql;\n}\n\nfunction percentile(arr: number[], p: number): number {\n  if (arr.length === 0) return 0;\n  const sorted = [...arr].sort((a, b) => a - b);\n  const idx = Math.ceil((p / 100) * sorted.length) - 1;\n  return sorted[Math.max(0, idx)];\n}\n\nexport function getQueryMetrics(): QueryMetrics {\n  const totalDurationMs = queryDurations.reduce((sum, d) => sum + d, 0);\n  const slowCount = queryDurations.filter((d) => d > SLOW_QUERY_THRESHOLD_MS).length;\n  \n  return {\n    totalQueries: totalQueriesExecuted,\n    totalDurationMs,\n    slowQueries: slowCount,\n    errorQueries: totalErrorQueries,\n    p50DurationMs: Math.round(percentile(queryDurations, 50)),\n    p95DurationMs: Math.round(percentile(queryDurations, 95)),\n    p99DurationMs: Math.round(percentile(queryDurations, 99)),\n    maxDurationMs: queryDurations.length > 0 ? Math.max(...queryDurations) : 0,\n  };\n}\n\nexport function getSlowQueriesLog(): SlowQuery[] {\n  // Return most recent first\n  return [...slowQueriesLog].reverse();\n}\n\nexport function resetQueryMetrics(): void {\n  queryDurations = [];\n  slowQueriesLog = [];\n  totalQueriesExecuted = 0;\n  totalErrorQueries = 0;\n}\n\n/**\n * Return query performance summary as structured object for logging/alerting.\n * Useful for periodic health check exports.\n */\nexport function summarizeQueryMetrics() {\n  const metrics = getQueryMetrics();\n  const slowQueries = getSlowQueriesLog().slice(0, 10); // Most recent 10\n  \n  return {\n    timestamp: new Date().toISOString(),\n    summary: {\n      totalQueries: metrics.totalQueries,\n      slowQueriesCount: metrics.slowQueries,\n      errorQueries: metrics.errorQueries,\n      averageDurationMs: metrics.totalQueries > 0 \n        ? Math.round(metrics.totalDurationMs / metrics.totalQueries) \n        : 0,\n      p50Ms: metrics.p50DurationMs,\n      p95Ms: metrics.p95DurationMs,\n      p99Ms: metrics.p99DurationMs,\n      maxMs: metrics.maxDurationMs,\n    },\n    recentSlow: slowQueries,\n  };\n}\n"
