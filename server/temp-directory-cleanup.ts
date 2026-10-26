import { lstat, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./storage-types.js";
import { isNotFound } from "./storage-utils.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";

/** 单题编译工作目录前缀。与 pruneWorkspaceTempArtifacts 的保留规则共用,避免两处拼字符串。 */
export const COMPILE_TEMP_PREFIX = "compile-";
/** 导出 staging 目录前缀。注意 `previous-export-` 与 `verify-export` 都不以此开头,不会被误删。 */
export const EXPORT_TEMP_PREFIX = "export-";
/** 同名导出提交期间保存上一份完整导出的目录前缀。只能由事务恢复模块清理。 */
export const PREVIOUS_EXPORT_PREFIX = "previous-export-";
/** 导出提交日志目录。通用按时间清理不得删除。 */
export const EXPORT_TRANSACTION_DIR_NAME = "export-transactions";

export interface TempArtifactRetentionRule {
  prefix: string;
  keepNewest: number;
}

/**
 * 按数量保留 .tmp 下的编译/导出产物。这些目录里的 PDF 和 tex 会通过 /tmp/... 暴露给
 * 渲染端(编译结果的「打开」按钮、导出失败的日志链接),所以不能用完即删,只能保留最近几份。
 * 启动时的 cleanupTempDirectory 按时间扫尾,这里负责会话内的数量上界。
 */
export async function pruneWorkspaceTempArtifacts(
  tempDir: string,
  rules: TempArtifactRetentionRule[]
) {
  try {
    await assertRealWorkspaceSubdir(tempDir);
  } catch (error) {
    if (error instanceof StorageError) {
      // 与 cleanupTempDirectory 一致:修剪是尽力而为的维护动作,目录不安全时跳过而非中断编译。
      console.warn(
        `跳过临时目录修剪:${tempDir} 未通过工作区安全校验。`,
        error.message
      );
      return;
    }
    throw error;
  }

  let entries;
  try {
    entries = await readdir(tempDir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  for (const rule of rules) {
    const matches = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== EXPORT_TRANSACTION_DIR_NAME &&
        entry.name.startsWith(rule.prefix)
    );
    if (matches.length <= rule.keepNewest) continue;
    const dated = (
      await Promise.all(
        matches.map(async (entry) => {
          const target = path.join(tempDir, entry.name);
          try {
            return { target, mtimeMs: (await stat(target)).mtimeMs };
          } catch {
            return null;
          }
        })
      )
    ).filter((item) => item !== null);
    dated.sort(
      (left, right) =>
        right.mtimeMs - left.mtimeMs || right.target.localeCompare(left.target)
    );
    await Promise.all(
      dated.slice(rule.keepNewest).map((item) =>
        // 外部查看器占用 PDF 时 Windows 会 EBUSY;修剪失败不能阻断本次编译或导出。
        rm(item.target, { recursive: true, force: true }).catch(() => undefined)
      )
    );
  }
}

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
  const protectExportStaging = await hasPendingExportTransactions(tempDir);
  await Promise.all(
    entries.map(async (entry) => {
      if (
        entry === EXPORT_TRANSACTION_DIR_NAME ||
        entry.startsWith(PREVIOUS_EXPORT_PREFIX) ||
        (protectExportStaging && entry.startsWith(EXPORT_TEMP_PREFIX))
      ) {
        return;
      }
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

async function hasPendingExportTransactions(tempDir: string): Promise<boolean> {
  try {
    const transactionDir = path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME);
    const info = await lstat(transactionDir);
    if (info.isSymbolicLink() || !info.isDirectory()) return true;
    const entries = await readdir(
      transactionDir,
      { withFileTypes: true }
    );
    // 非普通 .json 条目同样视为待处理事务；恢复流程会把它标记为 unresolved，
    // 通用清理则必须保留所有可能关联的 staging。
    return entries.some((entry) => entry.name.endsWith(".json"));
  } catch (error) {
    if (isNotFound(error)) return false;
    // 无法安全确认事务目录为空时宁可保留 staging，不做破坏性猜测。
    return true;
  }
}
