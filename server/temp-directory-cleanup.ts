import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./storage-types.js";
import { isNotFound } from "./storage-utils.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";

export async function cleanupTempDirectory(
  tempDir: string,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000
) {
  try {
    await assertRealWorkspaceSubdir(tempDir);
  } catch (error) {
    if (error instanceof StorageError) {
      // 清理是 best-effort 维护任务(含启动路径)。目录不安全时跳过而非中止,
      // 既不会跟随符号链接删除外部文件,也不会因此阻断应用启动。
      console.warn(
        `跳过临时目录清理:${tempDir} 未通过工作区安全校验。`,
        error.message
      );
      return;
    }
    throw error;
  }

  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(tempDir, entry);
      try {
        const metadata = await stat(target);
        if (metadata.mtimeMs < cutoff) {
          await rm(target, { recursive: true, force: true });
        }
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    })
  );
}
