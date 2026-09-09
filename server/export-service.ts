import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Bank, ExportRequest, ExportResponse } from "../shared/types.js";
import {
  buildFullLatex,
  buildQuestionOnlyLatex,
  compileLatex,
  copyAssetsForItems,
  listExportFiles,
  sanitizeFileName,
  selectedItems
} from "./latex.js";
import { withLatexExecutionSlot, type LatexExecutionSession } from "./latex-execution.js";
import { StorageError } from "./storage-types.js";
import {
  EXPORT_TEMP_PREFIX,
  pruneWorkspaceTempArtifacts
} from "./temp-directory-cleanup.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";
import { getWorkspaceDirs } from "./workspace-storage.js";
import {
  assertExportRecoveryComplete,
  commitExportDirectory,
  recoverExportTransactions
} from "./export-transaction.js";

export async function exportBank(
  bank: Bank,
  workspacePath: string,
  request: Omit<ExportRequest, "workspacePath" | "baseRevision">
): Promise<ExportResponse> {
  return withLatexExecutionSlot((session) => exportBankExclusive(bank, workspacePath, request, session));
}

async function exportBankExclusive(
  bank: Bank,
  workspacePath: string,
  request: Omit<ExportRequest, "workspacePath" | "baseRevision">,
  session: LatexExecutionSession
): Promise<ExportResponse> {
  const fileName = sanitizeFileName(request.fileName);
  const items = selectedItems(bank, request.itemIds, {
    orderMode: request.orderMode === "random" ? "random" : "normal",
    randomSeed: request.randomSeed || fileName
  });
  if (items.length === 0) {
    throw new StorageError("请至少勾选一道题目。", "EXPORT_EMPTY");
  }

  const { exportDir, tempDir } = getWorkspaceDirs(workspacePath);
  await Promise.all([
    assertRealWorkspaceSubdir(exportDir),
    assertRealWorkspaceSubdir(tempDir)
  ]);
  assertExportRecoveryComplete(
    await recoverExportTransactions(exportDir, tempDir)
  );
  const targetDir = path.join(exportDir, fileName);
  // 失败的 staging 目录会以 /tmp/... 链接给用户查看 tex 和日志,所以保留最近一份;
  // 在新建之前修剪,正在进行中的那份天然不会被删。
  await pruneWorkspaceTempArtifacts(tempDir, [
    { prefix: EXPORT_TEMP_PREFIX, keepNewest: 1 }
  ]);
  const stagingDir = path.join(tempDir, `${EXPORT_TEMP_PREFIX}${crypto.randomUUID()}`);
  await mkdir(stagingDir, { recursive: true });
  await copyAssetsForItems(items, stagingDir, workspacePath);

  const questionsTex = path.join(stagingDir, "questions.tex");
  const fullTex = path.join(stagingDir, "full.tex");
  await writeFile(questionsTex, buildQuestionOnlyLatex(items, bank.settings), "utf8");
  await writeFile(fullTex, buildFullLatex(items, bank.settings), "utf8");

  const questionsResult = await compileLatex(questionsTex, stagingDir, 60_000, session);
  const fullResult = await compileLatex(fullTex, stagingDir, 60_000, session);
  const ok = questionsResult.ok && fullResult.ok;
  const files = await listExportFiles(stagingDir);
  const results = ok
    ? { questions: questionsResult, full: fullResult }
    : {
        questions: {
          ...questionsResult,
          texUrl: toPublicTempUrl(questionsResult.texPath, tempDir),
          pdfUrl: questionsResult.pdfPath
            ? toPublicTempUrl(questionsResult.pdfPath, tempDir)
            : undefined
        },
        full: {
          ...fullResult,
          texUrl: toPublicTempUrl(fullResult.texPath, tempDir),
          pdfUrl: fullResult.pdfPath
            ? toPublicTempUrl(fullResult.pdfPath, tempDir)
            : undefined
        }
      };

  if (ok) {
    await commitExportDirectory(stagingDir, targetDir, tempDir);
  }

  return {
    ok,
    exportName: fileName,
    exportPath: ok ? targetDir : stagingDir,
    files,
    results
  };
}

function toPublicTempUrl(filePath: string, tempDir: string): string {
  const relative = path.relative(tempDir, filePath).split(path.sep).map(encodeURIComponent).join("/");
  return `/tmp/${relative}`;
}
