import { spawn } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./storage-types.js";
import { getCurrentWorkspaceDirs } from "./workspace-storage.js";

export async function getDefaultExportName(date = new Date()): Promise<string> {
  return nextDefaultExportName(await resolveCurrentExportRoot(), date);
}

export async function nextDefaultExportName(
  exportDir: string,
  date = new Date()
): Promise<string> {
  const prefix = `questions-${formatLocalDate(date)}`;
  const pattern = new RegExp(`^${escapeRegExp(prefix)}-([1-9]\\d*)$`);
  const entries = await readdir(exportDir, { withFileTypes: true });
  let maxSequence = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = pattern.exec(entry.name);
    if (!match) continue;
    const sequence = Number(match[1]);
    if (Number.isSafeInteger(sequence)) maxSequence = Math.max(maxSequence, sequence);
  }

  return `${prefix}-${maxSequence + 1}`;
}

export async function resolveCurrentExportDirectory(exportName: string): Promise<string> {
  if (!isSafeExportName(exportName)) {
    throw new StorageError("导出名无效。", "EXPORT_NAME_INVALID");
  }

  const resolvedRoot = await resolveCurrentExportRoot();
  const targetPath = path.join(resolvedRoot, exportName);
  const targetInfo = await lstat(targetPath).catch((error: unknown) => {
    if (isFileSystemCode(error, "ENOENT")) {
      throw new StorageError("导出目录不存在。", "EXPORT_DIRECTORY_MISSING");
    }
    throw error;
  });

  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
    throw new StorageError("导出位置不是有效目录。", "EXPORT_DIRECTORY_INVALID");
  }

  const resolvedTarget = await realpath(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || relative === "..") {
    throw new StorageError("导出目录超出当前工作区。", "EXPORT_DIRECTORY_FORBIDDEN");
  }
  if (path.dirname(relative) !== ".") {
    throw new StorageError("导出目录必须位于 exports 根目录。", "EXPORT_DIRECTORY_FORBIDDEN");
  }
  return resolvedTarget;
}

async function resolveCurrentExportRoot(): Promise<string> {
  const { workspaceDir, exportDir } = await getCurrentWorkspaceDirs();
  const [resolvedWorkspace, rootInfo, resolvedRoot] = await Promise.all([
    realpath(workspaceDir),
    lstat(exportDir),
    realpath(exportDir)
  ]);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new StorageError("exports 不是有效目录。", "EXPORT_ROOT_INVALID");
  }
  if (path.relative(resolvedWorkspace, resolvedRoot) !== "exports") {
    throw new StorageError("exports 目录超出当前工作区。", "EXPORT_ROOT_FORBIDDEN");
  }
  return resolvedRoot;
}

export async function revealCurrentExportDirectory(exportName: string): Promise<void> {
  await launchPathInFileManager(await resolveCurrentExportDirectory(exportName));
}

export async function launchPathInFileManager(
  targetPath: string,
  platform = process.platform
): Promise<void> {
  const [command, args] =
    platform === "darwin"
      ? ["open", [targetPath]]
      : platform === "win32"
        ? ["explorer.exe", [targetPath]]
        : ["xdg-open", [targetPath]];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSafeExportName(exportName: string): boolean {
  return Boolean(
    exportName &&
    exportName !== "." &&
    exportName !== ".." &&
    exportName === exportName.trim() &&
    path.basename(exportName) === exportName &&
    !hasControlCharacter(exportName)
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isFileSystemCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
