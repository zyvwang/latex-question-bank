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
  const content = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await writeFile(tempPath, content, { encoding: "utf8", flush: true });
    if (options.backup !== false && (await fileExists(filePath))) {
      await copyFile(filePath, backupPath);
      await syncFile(backupPath);
    }
    await rename(tempPath, filePath);
    await syncParentDirectoryBestEffort(path.dirname(filePath));
  } catch (error) {
    await rm(tempPath, { force: true });
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
