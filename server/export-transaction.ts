import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import path from "node:path";
import { writeJsonFileAtomic } from "./json-file.js";
import { StorageError } from "./storage-types.js";
import {
  EXPORT_TEMP_PREFIX,
  EXPORT_TRANSACTION_DIR_NAME,
  PREVIOUS_EXPORT_PREFIX
} from "./temp-directory-cleanup.js";
import {
  assertRealWorkspaceSubdir,
  resolveRealWorkspaceFile
} from "./workspace-paths.js";

export interface ExportTransactionRecord {
  version: 1;
  id: string;
  exportName: string;
  stagingName: string;
  previousName: string;
  hadPrevious: boolean;
  phase: "prepared" | "previous-moved" | "committed";
  createdAt: string;
}

export interface ExportTransactionFileOps {
  rename: typeof rename;
  rm: typeof rm;
}

export interface ExportRecoverySummary {
  recovered: number;
  finalized: number;
  unresolved: number;
}

const defaultFileOps: ExportTransactionFileOps = { rename, rm };
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activeCommitTempDirs = new Set<string>();

export async function commitExportDirectory(
  stagingDir: string,
  targetDir: string,
  tempDir: string,
  fileOps: ExportTransactionFileOps = defaultFileOps
) {
  const commitKey = path.resolve(tempDir);
  if (activeCommitTempDirs.has(commitKey)) {
    throw new StorageError(
      "已有导出正在提交，请稍后重试。",
      "EXPORT_BUSY",
      503
    );
  }
  activeCommitTempDirs.add(commitKey);
  try {
    await commitExportDirectoryExclusive(
      stagingDir,
      targetDir,
      tempDir,
      fileOps
    );
  } finally {
    activeCommitTempDirs.delete(commitKey);
  }
}

async function commitExportDirectoryExclusive(
  stagingDir: string,
  targetDir: string,
  tempDir: string,
  fileOps: ExportTransactionFileOps
) {
  await assertTransactionPaths(stagingDir, targetDir, tempDir);
  const id = crypto.randomUUID();
  const record: ExportTransactionRecord = {
    version: 1,
    id,
    exportName: path.basename(targetDir),
    stagingName: path.basename(stagingDir),
    previousName: `${PREVIOUS_EXPORT_PREFIX}${id}`,
    hadPrevious: (await entryKind(targetDir)) === "directory",
    phase: "prepared",
    createdAt: new Date().toISOString()
  };
  const recordPath = await writeTransactionRecord(tempDir, record);
  const previousDir = path.join(tempDir, record.previousName);
  let movedPrevious = false;

  if (record.hadPrevious) {
    try {
      await fileOps.rename(targetDir, previousDir);
      movedPrevious = true;
      record.phase = "previous-moved";
      await writeJsonFileAtomic(recordPath, record, { backup: false });
    } catch (error) {
      if (movedPrevious) {
        await restorePreviousOrThrow(
          previousDir,
          targetDir,
          recordPath,
          fileOps,
          error
        );
      } else {
        // 旧导出尚未移动时没有恢复动作；事务记录也不能留给启动流程误判。
        await fileOps.rm(recordPath, { force: true }).catch(() => undefined);
      }
      throw error;
    }
  }

  try {
    await fileOps.rename(stagingDir, targetDir);
  } catch (error) {
    if (movedPrevious) {
      await restorePreviousOrThrow(
        previousDir,
        targetDir,
        recordPath,
        fileOps,
        error
      );
      throw error;
    }
    throw recoveryRequiredError(error);
  }

  record.phase = "committed";
  await writeJsonFileAtomic(recordPath, record, { backup: false }).catch((error) => {
    console.warn("导出已提交，但无法更新导出事务阶段。", error);
  });
  let previousRemoved = true;
  if (movedPrevious) {
    try {
      await fileOps.rm(previousDir, { recursive: true, force: true });
    } catch (error) {
      previousRemoved = false;
      console.warn("导出已提交，但无法清理上一份导出。", error);
    }
  }
  if (previousRemoved) {
    await fileOps.rm(recordPath, { force: true }).catch((error) => {
      console.warn("导出已提交，但无法清理导出事务记录。", error);
    });
  }
}

export async function recoverExportTransactions(
  exportDir: string,
  tempDir: string,
  fileOps: ExportTransactionFileOps = defaultFileOps
): Promise<ExportRecoverySummary> {
  await Promise.all([
    assertRealWorkspaceSubdir(exportDir),
    assertRealWorkspaceSubdir(tempDir)
  ]);
  if (activeCommitTempDirs.has(path.resolve(tempDir))) {
    return { recovered: 0, finalized: 0, unresolved: 1 };
  }
  const transactionDir = path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME);
  const transactionKind = await entryKind(transactionDir);
  if (transactionKind === "missing") {
    return { recovered: 0, finalized: 0, unresolved: 0 };
  }
  if (transactionKind !== "directory") {
    console.warn("导出事务目录无效，保留现场并跳过自动恢复。", transactionDir);
    return { recovered: 0, finalized: 0, unresolved: 1 };
  }

  const entries = await readdir(transactionDir, { withFileTypes: true });
  const summary: ExportRecoverySummary = {
    recovered: 0,
    finalized: 0,
    unresolved: 0
  };
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue;
    if (!entry.isFile()) {
      summary.unresolved += 1;
      console.warn(`导出事务记录不是普通文件，已保留现场：${entry.name}`);
      continue;
    }
    const relativeRecordPath = path.join(
      EXPORT_TRANSACTION_DIR_NAME,
      entry.name
    );
    try {
      const recordPath = await resolveRealWorkspaceFile(
        tempDir,
        relativeRecordPath
      );
      const record = parseTransactionRecord(
        JSON.parse(await readFile(recordPath, "utf8")),
        entry.name
      );
      const result = await recoverTransaction(
        record,
        recordPath,
        exportDir,
        tempDir,
        fileOps
      );
      summary[result] += 1;
    } catch (error) {
      summary.unresolved += 1;
      console.warn(`无法恢复导出事务 ${entry.name}，已保留现场。`, error);
    }
  }
  return summary;
}

export function assertExportRecoveryComplete(summary: ExportRecoverySummary) {
  if (summary.unresolved === 0) return;
  throw new StorageError(
    "检测到未完成且无法自动恢复的导出，请保留 .tmp 内容并重启后重试。",
    "EXPORT_RECOVERY_REQUIRED",
    500
  );
}

async function recoverTransaction(
  record: ExportTransactionRecord,
  recordPath: string,
  exportDir: string,
  tempDir: string,
  fileOps: ExportTransactionFileOps
): Promise<"recovered" | "finalized" | "unresolved"> {
  const targetDir = path.join(exportDir, record.exportName);
  const stagingDir = path.join(tempDir, record.stagingName);
  const previousDir = path.join(tempDir, record.previousName);
  const [targetKind, stagingKind, previousKind] = await Promise.all([
    entryKind(targetDir),
    entryKind(stagingDir),
    entryKind(previousDir)
  ]);
  if ([targetKind, stagingKind, previousKind].includes("invalid")) {
    return "unresolved";
  }

  if (targetKind === "directory") {
    if (
      stagingKind === "directory" &&
      previousKind === "missing" &&
      record.phase !== "committed"
    ) {
      // 提交未开始，或即时回滚已恢复旧目标；保留失败 staging 供诊断。
      await fileOps.rm(recordPath, { force: true });
      return "finalized";
    }
    if (stagingKind !== "missing") return "unresolved";
    if (previousKind === "directory") {
      await fileOps.rm(previousDir, { recursive: true, force: true });
    }
    await fileOps.rm(recordPath, { force: true });
    return "finalized";
  }

  if (record.hadPrevious && previousKind === "directory") {
    await fileOps.rename(previousDir, targetDir);
    await fileOps.rm(recordPath, { force: true });
    return "recovered";
  }
  if (
    !record.hadPrevious &&
    previousKind === "missing" &&
    stagingKind === "directory"
  ) {
    await fileOps.rename(stagingDir, targetDir);
    await fileOps.rm(recordPath, { force: true });
    return "recovered";
  }
  return "unresolved";
}

async function restorePreviousOrThrow(
  previousDir: string,
  targetDir: string,
  recordPath: string,
  fileOps: ExportTransactionFileOps,
  originalError: unknown
) {
  try {
    await fileOps.rename(previousDir, targetDir);
    await fileOps.rm(recordPath, { force: true });
  } catch (restoreError) {
    console.error("导出提交和旧导出恢复均失败。", {
      originalError,
      restoreError
    });
    throw recoveryRequiredError(restoreError);
  }
}

async function writeTransactionRecord(
  tempDir: string,
  record: ExportTransactionRecord
): Promise<string> {
  const transactionDir = path.join(tempDir, EXPORT_TRANSACTION_DIR_NAME);
  await mkdir(transactionDir, { recursive: true });
  const recordPath = await resolveRealWorkspaceFile(
    tempDir,
    path.join(EXPORT_TRANSACTION_DIR_NAME, `${record.id}.json`),
    { allowMissing: true }
  );
  await writeJsonFileAtomic(recordPath, record, { backup: false });
  return recordPath;
}

async function assertTransactionPaths(
  stagingDir: string,
  targetDir: string,
  tempDir: string
) {
  await assertRealWorkspaceSubdir(tempDir);
  const exportDir = path.dirname(path.resolve(targetDir));
  await assertRealWorkspaceSubdir(exportDir);
  if (
    path.dirname(path.resolve(stagingDir)) !== path.resolve(tempDir) ||
    path.dirname(path.resolve(targetDir)) !== path.resolve(exportDir) ||
    !UUID_PATTERN.test(
      path.basename(stagingDir).slice(EXPORT_TEMP_PREFIX.length)
    ) ||
    !isSafeName(path.basename(targetDir))
  ) {
    throw new StorageError(
      "导出事务路径无效。",
      "EXPORT_TRANSACTION_PATH_INVALID",
      403
    );
  }
  const stagingKind = await entryKind(stagingDir);
  const targetKind = await entryKind(targetDir);
  if (
    stagingKind !== "directory" ||
    (targetKind !== "directory" && targetKind !== "missing")
  ) {
    throw new StorageError(
      "导出事务目录无效。",
      "EXPORT_TRANSACTION_ENTRY_INVALID"
    );
  }
}

function parseTransactionRecord(
  value: unknown,
  fileName: string
): ExportTransactionRecord {
  if (!isRecord(value)) throw new Error("事务记录必须是对象。");
  const record = value as Partial<ExportTransactionRecord>;
  if (
    record.version !== 1 ||
    typeof record.id !== "string" ||
    !UUID_PATTERN.test(record.id) ||
    fileName !== `${record.id}.json` ||
    typeof record.exportName !== "string" ||
    !isSafeName(record.exportName) ||
    typeof record.stagingName !== "string" ||
    !UUID_PATTERN.test(record.stagingName.slice(EXPORT_TEMP_PREFIX.length)) ||
    !isSafeName(record.stagingName) ||
    typeof record.previousName !== "string" ||
    record.previousName !== `${PREVIOUS_EXPORT_PREFIX}${record.id}` ||
    !isSafeName(record.previousName) ||
    typeof record.hadPrevious !== "boolean" ||
    !["prepared", "previous-moved", "committed"].includes(
      record.phase ?? ""
    ) ||
    typeof record.createdAt !== "string"
  ) {
    throw new Error("事务记录字段无效。");
  }
  return record as ExportTransactionRecord;
}

async function entryKind(
  targetPath: string
): Promise<"missing" | "directory" | "invalid"> {
  try {
    const info = await lstat(targetPath);
    return !info.isSymbolicLink() && info.isDirectory()
      ? "directory"
      : "invalid";
  } catch (error) {
    if (isFileSystemCode(error, "ENOENT")) return "missing";
    throw error;
  }
}

function isSafeName(value: string): boolean {
  return Boolean(
    value &&
    value !== "." &&
    value !== ".." &&
    path.basename(value) === value &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileSystemCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function recoveryRequiredError(cause: unknown): StorageError {
  return new StorageError(
    "导出提交未完成，已保留恢复记录；请重启应用后重试。",
    "EXPORT_RECOVERY_REQUIRED",
    500,
    { cause }
  );
}
