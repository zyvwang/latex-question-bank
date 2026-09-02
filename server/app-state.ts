import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AppState } from "../shared/types.js";
import {
  DEFAULT_UI_LAYOUT_PREFERENCES,
  normalizeUiLayoutPreferences,
  type UiLayoutPreferences
} from "../shared/ui-layout-preferences.js";
import { writeJsonFileAtomic } from "./json-file.js";

export const rootDir = path.resolve(process.env.LQB_ROOT_DIR ?? process.cwd());
export const appDataDir = path.resolve(process.env.LQB_APP_DATA_DIR ?? path.join(rootDir, ".app-data"));
export const appStatePath = path.join(appDataDir, "app-state.json");

let updateQueue: Promise<unknown> = Promise.resolve();

interface PersistedAppState extends AppState {
  uiLayout: UiLayoutPreferences;
}

export async function readPersistedAppState(): Promise<AppState> {
  return publicAppState(await readPersistedState());
}

export async function readUiLayoutPreferences(): Promise<UiLayoutPreferences> {
  return (await readPersistedState()).uiLayout;
}

async function readPersistedState(): Promise<PersistedAppState> {
  await mkdir(appDataDir, { recursive: true });
  try {
    return await readStateFile(appStatePath);
  } catch (error) {
    if (isNotFound(error)) return emptyAppState();
    if (!(error instanceof SyntaxError)) throw error;
  }

  try {
    return await readStateFile(`${appStatePath}.bak`);
  } catch (error) {
    if (isNotFound(error) || error instanceof SyntaxError) return emptyAppState();
    throw error;
  }
}

export async function writeAppState(state: AppState): Promise<AppState> {
  await mkdir(appDataDir, { recursive: true });
  const normalized = normalizeAppState(state);
  await writeJsonFileAtomic(appStatePath, normalized);
  return publicAppState(normalized);
}

export function updateAppState(
  updater: (state: AppState) => AppState | Promise<AppState>
): Promise<AppState> {
  const operation = updateQueue.then(async () => {
    const current = await readPersistedState();
    const next = normalizeAppState({
      ...(await updater(publicAppState(current))),
      uiLayout: current.uiLayout
    });
    await writeJsonFileAtomic(appStatePath, next);
    return publicAppState(next);
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}

export function updateUiLayoutPreferences(
  preferences: unknown
): Promise<UiLayoutPreferences> {
  const operation = updateQueue.then(async () => {
    const current = await readPersistedState();
    const next = normalizeAppState({
      ...current,
      uiLayout: preferences
    });
    await writeJsonFileAtomic(appStatePath, next);
    return next.uiLayout;
  });
  updateQueue = operation.catch(() => undefined);
  return operation;
}

export async function updateTexPathOverride(texPathOverride: string | undefined): Promise<AppState> {
  return updateAppState((state) => ({
    ...state,
    texPathOverride: texPathOverride?.trim() || undefined
  }));
}

export function normalizeRecent(paths: unknown[]): string[] {
  const seen = new Set<string>();
  const recent: string[] = [];
  for (const item of paths) {
    if (typeof item !== "string" || !item.trim()) continue;
    const resolved = path.resolve(item);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    recent.push(resolved);
  }
  return recent.slice(0, 10);
}

function normalizeAppState(input: unknown): PersistedAppState {
  const candidate = isRecord(input)
    ? (input as Partial<AppState> & { uiLayout?: unknown })
    : {};
  const currentWorkspacePath = safeOptionalString(candidate.currentWorkspacePath);
  const recentWorkspacePaths = candidate.recentWorkspacePaths ?? [];
  const normalizedCurrentWorkspacePath = currentWorkspacePath
    ? path.resolve(currentWorkspacePath)
    : undefined;
  const hasCurrentInRecent =
    normalizedCurrentWorkspacePath &&
    recentWorkspacePaths.some(
      (workspacePath) =>
        typeof workspacePath === "string" &&
        path.resolve(workspacePath) === normalizedCurrentWorkspacePath
    );
  return {
    version: 1,
    currentWorkspacePath: normalizedCurrentWorkspacePath,
    recentWorkspacePaths: normalizeRecent(
      normalizedCurrentWorkspacePath && !hasCurrentInRecent
        ? [normalizedCurrentWorkspacePath, ...recentWorkspacePaths]
        : recentWorkspacePaths
    ),
    texPathOverride: safeOptionalString(candidate.texPathOverride),
    uiLayout: normalizeUiLayoutPreferences(candidate.uiLayout)
  };
}

async function readStateFile(filePath: string): Promise<PersistedAppState> {
  return normalizeAppState(JSON.parse(await readFile(filePath, "utf8")));
}

function emptyAppState(): PersistedAppState {
  return {
    version: 1,
    recentWorkspacePaths: [],
    uiLayout: DEFAULT_UI_LAYOUT_PREFERENCES
  };
}

function publicAppState(state: PersistedAppState): AppState {
  return {
    version: 1,
    currentWorkspacePath: state.currentWorkspacePath,
    recentWorkspacePaths: state.recentWorkspacePaths,
    texPathOverride: state.texPathOverride
  };
}

function safeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
