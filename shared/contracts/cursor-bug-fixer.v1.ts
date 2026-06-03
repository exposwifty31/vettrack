/** Wire contracts for Cursor Cloud Agents bug-fixer integration (v1). */

export type CursorBugFixerDispatchSource = "manual" | "support_ticket" | "stability_log";

export interface CursorBugFixerBugReport {
  title: string;
  description: string;
  severity?: "low" | "medium" | "high";
  pageUrl?: string | null;
  deviceInfo?: string | null;
  appVersion?: string | null;
  /** Extra context (stack trace, log excerpt, test failure). */
  context?: string | null;
  supportTicketId?: string | null;
  source?: CursorBugFixerDispatchSource;
}

export interface CursorBugFixerDispatchResponse {
  agentId: string;
  runId: string;
  agentUrl: string;
  status: string;
}

export interface CursorBugFixerConfigResponse {
  enabled: boolean;
  apiKeyConfigured: boolean;
  repoUrlConfigured: boolean;
  defaultRef: string;
  autoCreatePr: boolean;
}

export interface CursorBugFixerAgentSummary {
  id: string;
  name: string;
  status: string;
  url: string;
  latestRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CursorBugFixerRunSummary {
  id: string;
  agentId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  result?: string;
  git?: {
    branches?: Array<{
      repoUrl: string;
      branch?: string;
      prUrl?: string;
    }>;
  };
}
