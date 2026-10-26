export const AGENT_BATCH_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function isAgentBatchId(value: string): boolean {
  return AGENT_BATCH_ID_PATTERN.test(value);
}

export interface AgentUndoCounts {
  deleted: number;
  restored: number;
  kept: number;
  assetsRemoved: number;
}

export interface AgentUndoSummary {
  batchId: string;
  status: "undone";
  revision: string;
  counts: AgentUndoCounts;
}

export interface AgentUndoRequest {
  batchId: string;
  workspacePath?: string;
  baseRevision?: string;
}
