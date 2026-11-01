import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { BUILTIN_SKINS } from "../shared/builtin-skins.js";
import { BUILTIN_SKIN_IDS, isSkinId, parseSkin, SKIN_MAX_BYTES, validateSkin, type Skin, type SkinIssue, type SkinList } from "../shared/skins.js";
import { appDataDir } from "./app-state.js";
import { writeJsonFileAtomic } from "./json-file.js";
import { broadcastSkinsChanged } from "./events.js";

export class SkinError extends Error {
  constructor(public readonly code: SkinIssue["code"], message: string, public readonly status = 400) { super(message); }
}
function unsafe(): never { throw new SkinError("SKIN_PATH", "skins: 请移除符号链接、非普通文件或越界路径。"); }
async function directory(create = false): Promise<string | null> {
  if (create) await mkdir(appDataDir, { recursive: true });
  const root = await realpath(appDataDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!root) return null;
  const dir = path.join(root, "skins");
  if (create) await mkdir(dir).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  const stat = await lstat(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(dir) !== dir) unsafe();
  return dir;
}
async function checkFile(dir: string, file: string): Promise<string | null> {
  const target = path.join(dir, file);
  if (path.dirname(target) !== dir) unsafe();
  const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(target) !== target) unsafe();
  return target;
}
async function readSkinFile(dir: string, file: string): Promise<Skin> {
  const target = await checkFile(dir, file);
  if (!target) throw new SkinError("SKIN_NOT_FOUND", `${file}: 文件不存在。`, 404);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) unsafe();
    if (stat.size > SKIN_MAX_BYTES) throw new SkinError("SKIN_TOO_LARGE", `${file}: 缩减到 16 KiB 以内。`);
    // 有界读取也覆盖检查 size 后文件增长的情况。
    const buffer = Buffer.alloc(SKIN_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const result = parseSkin(buffer.subarray(0, bytesRead).toString("utf8"));
    if (!result.ok) throw new SkinError(result.errors[0]!.code, result.errors.map((e) => e.message).join("\n"));
    if (`${result.value.id}.json` !== file) throw new SkinError("SKIN_ID", `${file}: 文件名须与 id 一致。`);
    return result.value;
  } finally { await handle.close(); }
}
export async function listSkins(): Promise<SkinList> {
  const result: SkinList = { skins: structuredClone([...BUILTIN_SKINS]), errors: [] };
  let dir: string | null;
  try { dir = await directory(); }
  catch (error) {
    if (!(error instanceof SkinError)) throw error;
    result.errors.push({ file: "skins", field: "skins", code: error.code, message: error.message });
    return result;
  }
  if (!dir) return result;
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith(".json")) continue;
    try { result.skins.push(await readSkinFile(dir, file)); }
    catch (error) {
      result.errors.push({ file, field: file, code: error instanceof SkinError ? error.code : "SKIN_READ", message: error instanceof SkinError ? error.message : `${file}: 无法读取，请检查文件权限和内容。` });
    }
  }
  return result;
}
let writeQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(action);
  writeQueue = result.catch(() => undefined);
  return result;
}
export function installSkin(value: unknown, overwrite: boolean): Promise<Skin> {
  return serialized(async () => {
    const validation = validateSkin(value);
    if (!validation.ok) throw new SkinError(validation.errors[0]!.code, validation.errors.map((e) => e.message).join("\n"));
    const skin = validation.value;
    const dir = (await directory(true))!;
    const existing = await checkFile(dir, `${skin.id}.json`);
    if (existing && !overwrite) throw new SkinError("SKIN_EXISTS", "id: 已存在；使用 --overwrite 覆盖。", 409);
    await directory();
    await writeJsonFileAtomic(path.join(dir, `${skin.id}.json`), skin, { backup: false });
    broadcastSkinsChanged({ id: skin.id });
    return skin;
  });
}
export function removeSkin(id: string): Promise<void> {
  return serialized(async () => {
    if (!isSkinId(id)) throw new SkinError("SKIN_ID", "id: 使用合法的皮肤 id。");
    if ((BUILTIN_SKIN_IDS as readonly string[]).includes(id)) throw new SkinError("SKIN_BUILTIN", "id: 内置皮肤不能删除。");
    const dir = await directory();
    const file = dir && await checkFile(dir, `${id}.json`);
    if (!file) throw new SkinError("SKIN_NOT_FOUND", "id: 皮肤不存在，请先 list。", 404);
    await directory();
    await rm(file);
    broadcastSkinsChanged({ id });
  });
}
