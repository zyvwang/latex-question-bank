import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

export async function writeJsonFileAtomic(
  filePath: string,
  value: unknown,
  options: { backup?: boolean } = {}
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const backupPath = `${filePath}.bak`;
  const backupTempPath = `${backupPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flush: true });
    if (options.backup !== false && (await fileExists(filePath))) {
      // 备份也必须 temp + rename。直接 copyFile 到 .bak 的话,崩在 copy 中途会留下
      // 截断的 .bak:主文件还是旧的好数据,唯一的恢复源却坏了 —— 而且是静默坏的,
      // recovery-storage 解析失败只会让这个候选从列表里消失。
      await copyFile(filePath, backupTempPath);
      await syncFile(backupTempPath);
      await rename(backupTempPath, backupPath);
    }
    await rename(tempPath, filePath);
    // 两次 rename 同目录,一次父目录 fsync 覆盖两者。
    await syncParentDirectoryBestEffort(path.dirname(filePath));
  } catch (error) {
    await rm(tempPath, { force: true });
    await rm(backupTempPath, { force: true });
    throw error;
  }
}

async function syncFile(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncParentDirectoryBestEffort(directoryPath: string) {
  if (process.platform === "win32") return;
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    console.warn(
      `JSON 文件已提交，但无法同步父目录 ${directoryPath}：`,
      error
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
