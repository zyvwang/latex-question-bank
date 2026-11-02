import { prepareQuestionAsset } from "./asset-service.js";
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultPaperSettings, parsePaper, parsePaperSettings, type Paper, type PaperList, type PaperSettings, type PaperSnapshot } from '../shared/papers.js';
import { writeJsonFileAtomic } from './json-file.js';
import { assertRealWorkspaceSubdir, resolveRealWorkspaceFile } from './workspace-paths.js';
import { revisionForContent, serializeJson, isNotFound } from './storage-utils.js';
import { StorageError } from './storage-types.js';

export async function papersDir(workspace: string, create = true): Promise<string> {
  const dir = await assertRealWorkspaceSubdir(path.join(workspace, 'papers'));
  if (create) await mkdir(dir, { recursive: true });
  return dir;
}
export function paperId(id: string): string {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new StorageError('试卷 ID 无效。', 'PAPER_INVALID');
  return id;
}
async function guarded(dir: string, file: string) {
  await resolveRealWorkspaceFile(dir, `${file}.bak`, { allowMissing: true });
  return resolveRealWorkspaceFile(dir, file, { allowMissing: true });
}
export async function readPaper(workspace: string, id: string): Promise<PaperSnapshot> {
  const dir = await papersDir(workspace, false);
  const raw = await readFile(await resolveRealWorkspaceFile(dir, `${paperId(id)}.json`), 'utf8');
  const paper = parsePaper(JSON.parse(raw));
  if (paper.id !== id) throw new StorageError('试卷 ID 不匹配。', 'PAPER_INVALID');
  return { paper, revision: revisionForContent(raw) };
}
export async function readPaperSettings(workspace: string): Promise<{ settings: PaperSettings; revision: string }> {
  const dir = await papersDir(workspace, false);
  try {
    const raw = await readFile(await resolveRealWorkspaceFile(dir, 'settings.json'), 'utf8');
    return { settings: parsePaperSettings(JSON.parse(raw)), revision: revisionForContent(raw) };
  } catch (e) {
    if (!isNotFound(e)) throw e;
    return { settings: defaultPaperSettings(), revision: '' };
  }
}
export async function savePaperSettings(workspace: string, settings: PaperSettings, revision: string) {
  const current = await readPaperSettings(workspace);
  checkRevision(current.revision, revision);
  const dir = await papersDir(workspace);
  await writeJsonFileAtomic(await guarded(dir, 'settings.json'), parsePaperSettings(settings));
  return readPaperSettings(workspace);
}
export function checkRevision(actual: string, expected: string) {
  if (actual !== expected) throw new StorageError('试卷已被修改，请核对磁盘版本后重试。', 'PAPER_CONFLICT', 409);
}
export async function writePaper(workspace: string, input: Paper): Promise<PaperSnapshot> {
  const paper = parsePaper(input);
  const dir = await papersDir(workspace);
  await writeJsonFileAtomic(await guarded(dir, `${paper.id}.json`), paper);
  return { paper, revision: revisionForContent(serializeJson(paper)) };
}
export async function listPapers(workspace: string): Promise<PaperList> {
  const dir = await papersDir(workspace, false);
  const result: PaperList = { papers: [], warnings: [] };
  let files: string[];
  try { files = await readdir(dir); } catch(e) { if (isNotFound(e)) return result; throw e; }
  for (const file of files.filter(f => f.endsWith('.json') && !['settings.json','topics.json'].includes(f))) {
    try {
      const { paper } = await readPaper(workspace, file.slice(0, -5));
      result.papers.push({ id: paper.id, title: paper.title, kind: paper.kind, updatedAt: paper.updatedAt, missing: paper.slots.filter(s => !s.snapshot).length });
    } catch { result.warnings.push(`无法读取试卷 ${file}，原文件已保留。`); }
  }
  result.papers.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  return result;
}
export async function deletePaper(workspace: string, id: string, revision: string) {
  checkRevision((await readPaper(workspace, id)).revision, revision);
  const dir = await papersDir(workspace);
  await unlink(await resolveRealWorkspaceFile(dir, `${paperId(id)}.json`));
  // Keep immutable attachments: other copies and .bak documents may still reference them.
}
export async function copyPaperAttachments(workspace: string, paper: Paper, old: Paper): Promise<void> {
  const dir = await papersDir(workspace);
  for (let i = 0; i < paper.slots.length; i++) {
    const item = paper.slots[i].snapshot;
    if (!item || item === old.slots[i]?.snapshot || JSON.stringify(item) === JSON.stringify(old.slots[i]?.snapshot)) continue;
    for (const asset of item.assets) {
      const source = await resolveRealWorkspaceFile(path.join(workspace, paper.slots[i].origin?.ref.kind === 'variant' ? 'variants' : 'assets'), asset.fileName);
      const bytes = await readFile(source);
      const prepared = await prepareQuestionAsset({ buffer: bytes, originalname: asset.fileName, mimetype: asset.mimeType, size: bytes.length });
      asset.sha256 = prepared.asset.sha256;
      const name = `asset-${crypto.randomUUID()}${path.extname(asset.fileName).toLowerCase()}`;
      const target = await resolveRealWorkspaceFile(dir, name, { allowMissing: true });
      await writeFile(target, bytes, { flag: 'wx' });
      for (const module of Object.values(item.modules)) module.tex = module.tex.replaceAll(asset.relativePath, `assets/${name}`).replaceAll(`assets/${asset.fileName}`, `assets/${name}`);
      asset.fileName = name;
      asset.relativePath = `assets/${name}`;
    }
  }
}
export async function copyPapersWorkspace(source: string, target: string) {
  const src = path.join(source, 'papers');
  await assertRealWorkspaceSubdir(src);
  let files: string[];
  try { files = await readdir(src); } catch(e) { if (isNotFound(e)) return; throw e; }
  const dst = await papersDir(target);
  for (const file of files) {
    // Flat storage intentionally rejects unexpected directories and symbolic links.
    await copyFile(await resolveRealWorkspaceFile(src, file), await resolveRealWorkspaceFile(dst, file, { allowMissing: true }));
  }
}
