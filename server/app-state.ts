import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AppState } from "../shared/types.js";
import { writeJsonFileAtomic } from "./json-file.js";

export const rootDir = path.resolve(process.env.LQB_ROOT_DIR ?? process.cwd());
export const appDataDir = path.resolve(process.env.LQB_APP_DATA_DIR ?? path.join(rootDir, ".app-data"));
export const appStatePath = path.join(appDataDir, "app-state.json");

let updateQueue: Promise<unknown> = Promise.resolve();

export async function readPersistedAppState(): Promise<AppState> {
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
  return normalized;
}

export function updateAppState(
  updater: (state: AppState) => AppState | Promise<AppState>
): Promise<AppState> {
  const operation = updateQueue.then(async () => {
    const current = await readPersistedAppState();
    return writeAppState(await updater(current));
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

function normalizeAppState(input: unknown): AppState {
  const candidate = isRecord(input) ? (input as Partial<AppState>) : {};
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
    texPathOverride: safeOptionalString(candidate.texPathOverride)
  };
}

async function readStateFile(filePath: string): Promise<AppState> {
  return normalizeAppState(JSON.parse(await readFile(filePath, "utf8")));
}

function emptyAppState(): AppState {
  return { version: 1, recentWorkspacePaths: [] };
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
