import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BankSnapshot } from "../shared/types.js";
import { StorageError } from "./storage-types.js";
import {
  isNotFound,
  parseStoredBank,
  revisionForContent
} from "./storage-utils.js";

export async function readBankSnapshotAt(
  workspacePath: string
): Promise<BankSnapshot> {
  const resolvedPath = path.resolve(workspacePath);
  try {
    const raw = await readFile(path.join(resolvedPath, "bank.json"), "utf8");
    return {
      workspacePath: resolvedPath,
      revision: revisionForContent(raw),
      bank: parseStoredBank(raw)
    };
  } catch (error) {
    if (isNotFound(error)) {
      throw new StorageError(
        "这个文件夹不是题库工作区：缺少 bank.json。请使用“新建”创建空工作区。",
        "WORKSPACE_MISSING"
      );
    }
    throw error;
  }
}
