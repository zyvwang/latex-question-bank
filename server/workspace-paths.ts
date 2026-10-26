import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./storage-types.js";

interface ResolveRealWorkspaceFileOptions {
  allowMissing?: boolean;
}

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

/**
 * 解析 workspace 顶层子目录内的普通文件，并拒绝路径中任意一层的符号链接。
 * 静态文件读取可允许目标缺失，让调用方返回 404；一旦路径存在，仍逐层 fail-closed。
 */
export async function resolveRealWorkspaceFile(
  subdirPath: string,
  relativePath: string,
  options: ResolveRealWorkspaceFileOptions = {}
): Promise<string> {
  const segments = validateRelativePath(relativePath);
  const realSubdirPath = await assertRealWorkspaceSubdir(subdirPath);
  const targetPath = path.join(realSubdirPath, ...segments);
  let currentPath = realSubdirPath;

  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    let info;
    try {
      info = await lstat(currentPath);
    } catch (error) {
      if (options.allowMissing && isNotFoundError(error)) return targetPath;
      throw error;
    }

    if (info.isSymbolicLink()) {
      throw new StorageError(
        `工作区文件路径不能包含符号链接：${relativePath}`,
        "WORKSPACE_ENTRY_SYMLINK",
        403
      );
    }
    const isFinalSegment = index === segments.length - 1;
    if ((!isFinalSegment && !info.isDirectory()) || (isFinalSegment && !info.isFile())) {
      throw new StorageError(
        `工作区文件路径不是普通文件：${relativePath}`,
        "WORKSPACE_ENTRY_INVALID"
      );
    }
  }

  const realTargetPath = await realpath(targetPath);
  const relativeRealPath = path.relative(realSubdirPath, realTargetPath);
  if (
    !relativeRealPath ||
    path.isAbsolute(relativeRealPath) ||
    relativeRealPath === ".." ||
    relativeRealPath.startsWith(`..${path.sep}`)
  ) {
    throw new StorageError(
      `工作区文件超出允许范围：${relativePath}`,
      "WORKSPACE_ENTRY_ESCAPE",
      403
    );
  }
  return realTargetPath;
}

function validateRelativePath(relativePath: string): string[] {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throwInvalidWorkspaceEntry(relativePath);
  }
  const segments = relativePath.split(/[\\/]/);
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes("\0")
    )
  ) {
    throwInvalidWorkspaceEntry(relativePath);
  }
  return segments;
}

function throwInvalidWorkspaceEntry(relativePath: string): never {
  throw new StorageError(
    `工作区文件路径无效：${relativePath || "(empty)"}`,
    "WORKSPACE_ENTRY_INVALID"
  );
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
