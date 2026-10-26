import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeUniqueName } from "../shared/names.js";
import type {
  Bank,
  BankSnapshot,
  Chapter,
  LatexSettings
} from "../shared/types.js";
import {
  hasControlCharacter,
  isRecord,
  ValidationError
} from "../shared/validation-primitives.js";
import { readBankSnapshotAt } from "./bank-reader.js";
import { defaultSettings } from "./bank-schema.js";
import { refreshAgentDiscovery } from "./agent-discovery.js";
import { withWorkspaceWriteLock } from "./storage-lock.js";
import { StorageError } from "./storage-types.js";
import {
  createWorkspaceWithBank,
  getDefaultWorkspaceRoot,
  readAppState,
  switchWorkspace,
  workspaceExists,
  type WorkspaceTransition
} from "./workspace-storage.js";

const MAX_CHAPTERS = 200;

export interface AgentWorkspaceCreateInput {
  name: string;
  path?: string;
  copySettingsFromCurrent?: boolean;
  chapters?: string[];
  switchWorkspace?: boolean;
}

export interface AgentWorkspaceCreateResult {
  workspacePath: string;
  snapshot: BankSnapshot;
  switched: boolean;
}

export function parseAgentWorkspaceCreateInput(
  value: unknown
): AgentWorkspaceCreateInput {
  if (!isRecord(value)) throw new ValidationError("请求体必须是对象。");
  const name = normalizeAgentBankName(value.name);
  const requestedPath = value.path;
  if (
    requestedPath !== undefined &&
    requestedPath !== null &&
    typeof requestedPath !== "string"
  ) {
    throw new ValidationError("path 必须是字符串。");
  }
  if (
    value.copySettingsFromCurrent !== undefined &&
    typeof value.copySettingsFromCurrent !== "boolean"
  ) {
    throw new ValidationError("copySettingsFromCurrent 必须是布尔值。");
  }
  if (value.switch !== undefined && typeof value.switch !== "boolean") {
    throw new ValidationError("switch 必须是布尔值。");
  }
  const chapters = value.chapters ?? [];
  if (
    !Array.isArray(chapters) ||
    chapters.some((chapter) => typeof chapter !== "string")
  ) {
    throw new ValidationError("chapters 必须是字符串数组。");
  }
  return {
    name,
    path: typeof requestedPath === "string" ? requestedPath.trim() || undefined : undefined,
    copySettingsFromCurrent: value.copySettingsFromCurrent !== false,
    chapters: chapters as string[],
    switchWorkspace: value.switch === true
  };
}

export function normalizeAgentBankName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError("题库名称不能为空。");
  }
  const name = value.trim().normalize("NFKC");
  if (hasControlCharacter(name)) {
    throw new ValidationError("题库名称含有无效字符。");
  }
  return name;
}

export function resolveAgentWorkspacePath(
  name: string,
  requestedPath?: string | null
): string {
  const normalizedName = normalizeAgentBankName(name);
  if (requestedPath?.trim()) {
    if (!path.isAbsolute(requestedPath.trim())) {
      throw new ValidationError("题库路径必须是绝对路径。");
    }
    return path.resolve(requestedPath.trim());
  }
  return path.join(
    getDefaultWorkspaceRoot(),
    safeFolderName(normalizedName)
  );
}

export function normalizeAgentChapterNames(values: string[]): string[] {
  if (values.length > MAX_CHAPTERS) {
    throw new ValidationError(`最多支持 ${MAX_CHAPTERS} 个章节。`);
  }
  const seen = new Set<string>();
  return values.map((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new ValidationError(`第 ${index + 1} 个章节名称不能为空。`);
    }
    const name = value.trim().normalize("NFKC");
    if (hasControlCharacter(name)) {
      throw new ValidationError(`章节名称无效：${name}`);
    }
    const key = normalizeUniqueName(name);
    if (seen.has(key)) {
      throw new ValidationError(`章节名称重复：${name}`);
    }
    seen.add(key);
    return name;
  });
}

export async function buildAgentBank(input: {
  chapters?: string[];
  copySettingsFromCurrent?: boolean;
}): Promise<Bank> {
  const chapterNames = normalizeAgentChapterNames(input.chapters ?? []);
  const settings =
    input.copySettingsFromCurrent === false
      ? defaultSettings
      : await readCurrentSettings();
  const chapters: Chapter[] = chapterNames.map((name, index) => ({
    id: randomUUID(),
    name,
    order: index + 1
  }));
  return {
    version: 3,
    settings,
    chapters,
    books: [],
    imports: [],
    items: []
  };
}

export async function assertAgentWorkspaceAvailable(
  workspacePath: string
): Promise<void> {
  if (await workspaceExists(workspacePath)) {
    throw new StorageError(
      "该文件夹已经是题库工作区。请选择其他路径。",
      "WORKSPACE_ALREADY_EXISTS"
    );
  }
}

export async function createAgentWorkspace(
  input: AgentWorkspaceCreateInput
): Promise<AgentWorkspaceCreateResult> {
  const workspacePath = resolveAgentWorkspacePath(input.name, input.path);
  const bank = await buildAgentBank({
    chapters: input.chapters,
    copySettingsFromCurrent: input.copySettingsFromCurrent
  });
  await assertAgentWorkspaceAvailable(workspacePath);
  await withWorkspaceWriteLock(workspacePath, async () => {
    await assertAgentWorkspaceAvailable(workspacePath);
    await createWorkspaceWithBank(workspacePath, bank);
  });
  const transition = input.switchWorkspace
    ? await activateAgentWorkspace(workspacePath)
    : null;
  const snapshot =
    transition?.snapshot ?? (await readBankSnapshotAt(workspacePath));
  return {
    workspacePath,
    snapshot,
    switched: Boolean(transition)
  };
}

export async function activateAgentWorkspace(
  workspacePath: string
): Promise<WorkspaceTransition> {
  const transition = await switchWorkspace(workspacePath);
  await refreshAgentDiscovery(
    transition.appState.currentWorkspacePath
  ).catch((error) => {
    console.warn("刷新 Agent 发现文件失败。", error);
  });
  return transition;
}

async function readCurrentSettings(): Promise<LatexSettings> {
  const state = await readAppState();
  if (!state.currentWorkspacePath) return defaultSettings;
  const snapshot = await readBankSnapshotAt(state.currentWorkspacePath);
  return snapshot.bank.settings;
}

function safeFolderName(name: string): string {
  const withoutReserved = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return withoutReserved || "未命名题库";
}
