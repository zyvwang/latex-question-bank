import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LatexSettings, QuestionItem } from "../shared/types.js";
import { buildFullLatex } from "./latex-renderer.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";
import {
  getCurrentWorkspaceDirs,
  getWorkspaceDirs
} from "./workspace-storage.js";

export async function writeCurrentItemCheck(
  item: QuestionItem,
  settings: LatexSettings
): Promise<string> {
  const { tempDir } = await getCurrentWorkspaceDirs();
  await assertRealWorkspaceSubdir(tempDir);
  const workDir = path.join(tempDir, `compile-${crypto.randomUUID()}`);
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await copyAssetsForItems([item], workDir);
  const texPath = path.join(workDir, "current-item.tex");
  await writeFile(texPath, buildFullLatex([item], settings), "utf8");
  return texPath;
}

export async function copyAssetsForItems(
  items: QuestionItem[],
  targetDir: string,
  workspacePath?: string
) {
  const { assetDir } = workspacePath
    ? getWorkspaceDirs(workspacePath)
    : await getCurrentWorkspaceDirs();
  await assertRealWorkspaceSubdir(assetDir);
  const targetAssetDir = path.join(targetDir, "assets");
  await mkdir(targetAssetDir, { recursive: true });
  const fileNames = new Set(
    items.flatMap((item) => item.assets.map((asset) => asset.fileName).filter(Boolean))
  );
  await Promise.all(
    [...fileNames].map(async (fileName) => {
      const source = path.join(assetDir, path.basename(fileName));
      const target = path.join(targetAssetDir, path.basename(fileName));
      try {
        await access(source, constants.R_OK);
        await copyFile(source, target);
      } catch {
        // Compilation reports missing assets while preserving the generated source.
      }
    })
  );
}

export async function listExportFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((file) => /\.(tex|pdf)$/i.test(file)).sort();
  } catch {
    return [];
  }
}
