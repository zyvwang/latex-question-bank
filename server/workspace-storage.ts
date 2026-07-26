import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppState, WorkspaceSummary } from "../shared/types.js";
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
import { fileExists, safeOptionalString } from "./storage-utils.js";

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
    await cleanupTempDirectory(getWorkspaceDirs(state.currentWorkspacePath).tempDir);
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

export async function createEmptyWorkspace(workspacePath: string): Promise<AppState> {
  return createWorkspace(workspacePath, false);
}

export async function createSampleWorkspace(workspacePath: string): Promise<AppState> {
  return createWorkspace(workspacePath, true);
}

async function createWorkspace(workspacePath: string, sample: boolean): Promise<AppState> {
  const resolvedPath = path.resolve(workspacePath);
  if (await workspaceExists(resolvedPath)) {
    throw new Error(
      sample
        ? "该文件夹已经是题库工作区。请选择一个新文件夹，或使用“打开”切换到它。"
        : "该文件夹已经是题库工作区。请使用“打开”切换到它。"
    );
  }
  await ensureWorkspace(resolvedPath, { sample });
  return switchWorkspace(resolvedPath);
}

export async function openExistingWorkspace(workspacePath: string): Promise<AppState> {
  const resolvedPath = path.resolve(workspacePath);
  if (!(await workspaceExists(resolvedPath))) {
    throw new Error("这个文件夹不是题库工作区：缺少 bank.json。请使用“新建”创建空工作区。");
  }
  return switchWorkspace(resolvedPath);
}

export async function switchWorkspace(workspacePath: string): Promise<AppState> {
  const resolvedPath = path.resolve(workspacePath);
  if (!(await workspaceExists(resolvedPath))) {
    throw new StorageError(
      "这个文件夹不是题库工作区：缺少 bank.json。请使用“新建”创建空工作区。",
      "WORKSPACE_MISSING"
    );
  }
  return updateAppState((state) => ({
    ...state,
    currentWorkspacePath: resolvedPath,
    recentWorkspacePaths: normalizeRecent([resolvedPath, ...state.recentWorkspacePaths])
  }));
}

export async function removeWorkspace(workspacePath: string): Promise<AppState> {
  const resolvedPath = path.resolve(workspacePath);
  return updateAppState(async (state) => {
    const recentWorkspacePaths = state.recentWorkspacePaths.filter((item) => item !== resolvedPath);
    let currentWorkspacePath = state.currentWorkspacePath;
    if (state.currentWorkspacePath === resolvedPath) {
      const existence = await Promise.all(
        recentWorkspacePaths.map(async (candidate) => ({
          candidate,
          exists: await workspaceExists(candidate)
        }))
      );
      currentWorkspacePath = existence.find((entry) => entry.exists)?.candidate;
    }
    return { ...state, currentWorkspacePath, recentWorkspacePaths };
  });
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

export async function listRecentWorkspaces(): Promise<WorkspaceSummary[]> {
  const state = await readAppState();
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
  if (!state.currentWorkspacePath) throw new Error("尚未选择题库工作区。");
  return getWorkspaceDirs(state.currentWorkspacePath);
}

export async function ensureWorkspace(
  workspacePath: string,
  options: { sample: boolean }
): Promise<WorkspaceDirs> {
  const dirs = getWorkspaceDirs(workspacePath);
  await Promise.all([
    mkdir(dirs.workspaceDir, { recursive: true }),
    mkdir(dirs.assetDir, { recursive: true }),
    mkdir(dirs.exportDir, { recursive: true }),
    mkdir(dirs.tempDir, { recursive: true })
  ]);
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
