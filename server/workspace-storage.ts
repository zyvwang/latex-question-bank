import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AppState,
  BankSnapshot,
  WorkspaceSummary
} from "../shared/types.js";
import {
  appDataDir,
  appStatePath,
  normalizeRecent,
  readPersistedAppState,
  updateAppState,
  writeAppState
} from "./app-state.js";
import { createEmptyBank, createSampleBank } from "./bank-schema.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { StorageError, type WorkspaceDirs } from "./storage-types.js";
import { resetSessionHistory } from "./storage-session.js";
import { cleanupTempDirectory } from "./temp-directory-cleanup.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";
import { fileExists, safeOptionalString } from "./storage-utils.js";
import { readBankSnapshotAt } from "./bank-reader.js";
import { recoverExportTransactions } from "./export-transaction.js";

const forcedWorkspacePath = process.env.LQB_WORKSPACE_DIR
  ? path.resolve(process.env.LQB_WORKSPACE_DIR)
  : "";

export async function ensureProjectDirs() {
  await mkdir(appDataDir, { recursive: true });
  if (!forcedWorkspacePath && !(await fileExists(appStatePath))) {
    await writeAppState({ version: 1, recentWorkspacePaths: [] });
  }
  const state = await readAppState();
  if (state.currentWorkspacePath && (await workspaceExists(state.currentWorkspacePath))) {
    const dirs = getWorkspaceDirs(state.currentWorkspacePath);
    await recoverExportTransactions(dirs.exportDir, dirs.tempDir);
    await cleanupTempDirectory(dirs.tempDir);
  }
}

export async function readAppState(): Promise<AppState> {
  await mkdir(appDataDir, { recursive: true });

  if (forcedWorkspacePath) {
    await ensureWorkspace(forcedWorkspacePath, { sample: false });
    return {
      version: 1,
      currentWorkspacePath: forcedWorkspacePath,
      recentWorkspacePaths: [forcedWorkspacePath],
      texPathOverride: safeOptionalString(process.env.LQB_LATEXMK_PATH)
    };
  }

  return readPersistedAppState();
}

export interface WorkspaceTransition {
  appState: AppState;
  snapshot: BankSnapshot | null;
}

export async function createEmptyWorkspace(
  workspacePath: string
): Promise<WorkspaceTransition> {
  return createWorkspace(workspacePath, false);
}

export async function createSampleWorkspace(
  workspacePath: string
): Promise<WorkspaceTransition> {
  return createWorkspace(workspacePath, true);
}

async function createWorkspace(
  workspacePath: string,
  sample: boolean
): Promise<WorkspaceTransition> {
  const resolvedPath = path.resolve(workspacePath);
  if (await workspaceExists(resolvedPath)) {
    throw new StorageError(
      sample
        ? "该文件夹已经是题库工作区。请选择一个新文件夹，或使用“打开”切换到它。"
        : "该文件夹已经是题库工作区。请使用“打开”切换到它。",
      "WORKSPACE_ALREADY_EXISTS"
    );
  }
  await ensureWorkspace(resolvedPath, { sample });
  return switchWorkspace(resolvedPath);
}

export async function openExistingWorkspace(
  workspacePath: string
): Promise<WorkspaceTransition> {
  return switchWorkspace(workspacePath);
}

export async function switchWorkspace(
  workspacePath: string
): Promise<WorkspaceTransition> {
  const resolvedPath = path.resolve(workspacePath);
  let snapshot: BankSnapshot | null = null;
  const appState = await updateAppState(async (state) => {
    // 验证必须发生在 app-state 提交前。这样损坏的目标不会让服务端与渲染端
    // 分别停留在两个工作区，后续旧题库保存也不会误报 WORKSPACE_CHANGED。
    snapshot = await readBankSnapshotAt(resolvedPath);
    // git 或 zip 分发的工作区常常只带 bank.json；解析成功后再补齐并校验子目录。
    await ensureWorkspace(resolvedPath, { sample: false });
    return {
      ...state,
      currentWorkspacePath: resolvedPath,
      recentWorkspacePaths: normalizeRecent([
        resolvedPath,
        ...state.recentWorkspacePaths
      ])
    };
  });
  if (!snapshot) {
    throw new StorageError(
      "工作区切换没有返回题库快照。",
      "WORKSPACE_TRANSITION_INVALID",
      500
    );
  }
  return { appState, snapshot };
}

export async function relocateWorkspace(
  workspacePath: string,
  replacementPath: string
): Promise<WorkspaceTransition> {
  const resolvedPath = path.resolve(workspacePath);
  const resolvedReplacement = path.resolve(replacementPath);
  if (resolvedPath === resolvedReplacement) {
    throw new StorageError(
      "重新定位路径不能与原路径相同。",
      "WORKSPACE_RELOCATE_SAME_PATH"
    );
  }
  let snapshot: BankSnapshot | null = null;
  const appState = await updateAppState(async (state) => {
    snapshot = await readBankSnapshotAt(resolvedReplacement);
    await ensureWorkspace(resolvedReplacement, { sample: false });
    return {
      ...state,
      currentWorkspacePath: resolvedReplacement,
      recentWorkspacePaths: normalizeRecent([
        resolvedReplacement,
        ...state.recentWorkspacePaths.filter(
          (item) => path.resolve(item) !== resolvedPath
        )
      ])
    };
  });
  if (!snapshot) {
    throw new StorageError(
      "工作区重新定位没有返回题库快照。",
      "WORKSPACE_TRANSITION_INVALID",
      500
    );
  }
  return { appState, snapshot };
}

export async function removeWorkspace(
  workspacePath: string
): Promise<WorkspaceTransition> {
  const resolvedPath = path.resolve(workspacePath);
  let snapshot: BankSnapshot | null = null;
  const appState = await updateAppState(async (state) => {
    const recentWorkspacePaths = state.recentWorkspacePaths.filter(
      (item) => path.resolve(item) !== resolvedPath
    );
    let currentWorkspacePath = state.currentWorkspacePath;
    if (
      state.currentWorkspacePath &&
      path.resolve(state.currentWorkspacePath) === resolvedPath
    ) {
      currentWorkspacePath = undefined;
      for (const candidate of recentWorkspacePaths) {
        try {
          snapshot = await readBankSnapshotAt(candidate);
          await ensureWorkspace(candidate, { sample: false });
          currentWorkspacePath = candidate;
          break;
        } catch (error) {
          snapshot = null;
          console.warn(`跳过不可用的最近工作区：${candidate}`, error);
        }
      }
    }
    return { ...state, currentWorkspacePath, recentWorkspacePaths };
  });
  return { appState, snapshot };
}

export async function moveWorkspace(workspacePath: string, direction: -1 | 1): Promise<AppState> {
  const resolvedPath = path.resolve(workspacePath);
  return updateAppState((state) => {
    const recentWorkspacePaths = [...state.recentWorkspacePaths];
    const index = recentWorkspacePaths.indexOf(resolvedPath);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= recentWorkspacePaths.length) return state;
    [recentWorkspacePaths[index], recentWorkspacePaths[targetIndex]] = [
      recentWorkspacePaths[targetIndex],
      recentWorkspacePaths[index]
    ];
    return { ...state, recentWorkspacePaths };
  });
}

export async function listRecentWorkspaces(
  appState?: AppState
): Promise<WorkspaceSummary[]> {
  const state = appState ?? (await readAppState());
  return Promise.all(
    state.recentWorkspacePaths.map(async (workspacePath) => ({
      name: workspaceNameFromPath(workspacePath),
      path: workspacePath,
      exists: await fileExists(path.join(workspacePath, "bank.json"))
    }))
  );
}

export function getWorkspaceDirs(workspacePath: string): WorkspaceDirs {
  const workspaceDir = path.resolve(workspacePath);
  return {
    workspaceDir,
    bankPath: path.join(workspaceDir, "bank.json"),
    assetDir: path.join(workspaceDir, "assets"),
    exportDir: path.join(workspaceDir, "exports"),
    tempDir: path.join(workspaceDir, ".tmp"),
    historyDir: path.join(workspaceDir, ".history")
  };
}

export async function getCurrentWorkspaceDirs(): Promise<WorkspaceDirs> {
  const state = await readAppState();
  if (!state.currentWorkspacePath) {
    throw new StorageError("尚未选择题库工作区。", "WORKSPACE_NOT_SELECTED");
  }
  return getWorkspaceDirs(state.currentWorkspacePath);
}

export async function ensureWorkspace(
  workspacePath: string,
  options: { sample: boolean }
): Promise<WorkspaceDirs> {
  const dirs = getWorkspaceDirs(workspacePath);
  await mkdir(dirs.workspaceDir, { recursive: true });
  // 新建与打开/切换都会走到这里:拒绝把子目录做成符号链接(fail-closed),
  // 避免后续读写删逃逸到 workspace 外部。
  await Promise.all([
    assertRealWorkspaceSubdir(dirs.assetDir),
    assertRealWorkspaceSubdir(dirs.exportDir),
    assertRealWorkspaceSubdir(dirs.tempDir),
    assertRealWorkspaceSubdir(dirs.historyDir)
  ]);
  await Promise.all([
    mkdir(dirs.assetDir, { recursive: true }),
    mkdir(dirs.exportDir, { recursive: true }),
    mkdir(dirs.tempDir, { recursive: true })
  ]);
  await recoverExportTransactions(dirs.exportDir, dirs.tempDir);
  if (!(await fileExists(dirs.bankPath))) {
    resetSessionHistory(dirs.workspaceDir);
    const bank = options.sample ? createSampleBank() : createEmptyBank();
    await writeJsonFileAtomic(dirs.bankPath, bank, { backup: false });
  }
  return dirs;
}

export function workspaceNameFromPath(workspacePath: string): string {
  return path.basename(path.resolve(workspacePath)) || "Untitled Bank";
}

export function getDefaultWorkspaceRoot(): string {
  return path.join(os.homedir(), "Documents", "LaTeX Question Bank");
}

export async function workspaceExists(workspacePath: string): Promise<boolean> {
  try {
    const result = await stat(path.join(workspacePath, "bank.json"));
    return result.isFile();
  } catch {
    return false;
  }
}

export async function isKnownWorkspacePath(targetPath: string): Promise<boolean> {
  const resolvedTarget = path.resolve(targetPath);
  const state = await readAppState();
  const allowedPaths = [state.currentWorkspacePath, ...state.recentWorkspacePaths]
    .filter((workspacePath): workspacePath is string => Boolean(workspacePath))
    .map((workspacePath) => path.resolve(workspacePath));
  return allowedPaths.some((workspacePath) => workspacePath === resolvedTarget);
}
