import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./storage-types.js";

/**
 * 校验 workspace 顶层子目录(.tmp/.history/assets/exports)在读、写、删、rename 前
 * 确实是位于 workspace 内部的真实目录,而非指向外部路径的符号链接。
 *
 * fail-closed:子目录是符号链接或其 realpath 逃逸出 workspace 时抛 StorageError,
 * 阻止对外部文件的删除或覆盖。子目录尚不存在时返回预期路径,交由调用方创建。
 */
export async function assertRealWorkspaceSubdir(subdirPath: string): Promise<string> {
  const resolvedSubdirPath = path.resolve(subdirPath);
  const workspaceDir = path.dirname(resolvedSubdirPath);
  const name = path.basename(resolvedSubdirPath);

  let info;
  try {
    info = await lstat(resolvedSubdirPath);
  } catch (error) {
    if (isNotFoundError(error)) return resolvedSubdirPath;
    throw error;
  }

  if (info.isSymbolicLink()) {
    throw new StorageError(
      `工作区子目录 ${name} 不能是符号链接。`,
      "WORKSPACE_SUBDIR_SYMLINK",
      403
    );
  }
  if (!info.isDirectory()) {
    throw new StorageError(
      `工作区子目录 ${name} 必须是目录。`,
      "WORKSPACE_SUBDIR_INVALID"
    );
  }

  const [resolvedWorkspace, resolvedReal] = await Promise.all([
    realpath(workspaceDir),
    realpath(resolvedSubdirPath)
  ]);
  if (path.relative(resolvedWorkspace, resolvedReal) !== name) {
    throw new StorageError(
      `工作区子目录 ${name} 超出工作区范围。`,
      "WORKSPACE_SUBDIR_ESCAPE",
      403
    );
  }
  return resolvedReal;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
