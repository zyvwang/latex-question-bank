import { readFileSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAgentToken } from "./agent-auth.js";
import { readAppState } from "./workspace-storage.js";

export interface AgentDiscoveryInfo {
  version: 1;
  port: number;
  token: string;
  pid: number;
  workspacePath: string;
  appVersion: string;
  startedAt: string;
}

let runtimePort = 0;
let runtimeAppVersion = "0.0.0";
const runtimeStartedAt = new Date().toISOString();

export function configureAgentDiscovery(input: {
  port: number;
  appVersion?: string;
}): void {
  runtimePort = input.port;
  runtimeAppVersion =
    input.appVersion ?? process.env.LQB_APP_VERSION ?? defaultAppVersion();
}

export function agentRuntimeAppVersion(): string {
  return runtimeAppVersion;
}

function defaultAppVersion(): string {
  try {
    const value = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ) as { version?: unknown };
    return typeof value.version === "string" ? value.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function agentDiscoveryPath(): string {
  const override = process.env.LQB_AGENT_DISCOVERY_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), ".lqb", "agent.json");
}

export async function refreshAgentDiscovery(
  workspacePath?: string
): Promise<void> {
  if (process.env.VITEST && !process.env.LQB_AGENT_DISCOVERY_FILE) return;
  if (!runtimePort) return;
  const currentWorkspace =
    workspacePath ?? (await readAppState()).currentWorkspacePath ?? "";
  const filePath = agentDiscoveryPath();
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  const info: AgentDiscoveryInfo = {
    version: 1,
    port: runtimePort,
    token: getAgentToken(),
    pid: process.pid,
    workspacePath: currentWorkspace,
    appVersion: runtimeAppVersion,
    startedAt: runtimeStartedAt
  };
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(info, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeAgentDiscovery(): Promise<void> {
  if (process.env.VITEST && !process.env.LQB_AGENT_DISCOVERY_FILE) return;
  await rm(agentDiscoveryPath(), { force: true }).catch(() => undefined);
}
