import { Router, json } from "express";
import multer from "multer";
import path from "node:path";
import {
  validateWorkspacePathRequest,
  validateCompileItemRequest,
  validateExportRequest,
  validateRevealExportRequest
} from "../../shared/validation.js";
import { saveQuestionAsset } from "../asset-service.js";
import { readBankSnapshot } from "../bank-storage.js";
import {
  getDefaultExportName,
  revealCurrentExportDirectory
} from "../export-directory-service.js";
import { exportBank } from "../export-service.js";
import { sendApiError } from "../http/api-response.js";
import { writeCurrentItemCheck } from "../latex-files.js";
import { withLatexExecutionSlot } from "../latex-execution.js";
import { compileLatex } from "../latex-runtime.js";
import { StorageError } from "../storage-types.js";
import { getCurrentWorkspaceDirs } from "../workspace-storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    callback(null, ["image/png", "image/jpeg"].includes(file.mimetype));
  }
});

export function createDocumentRouter(options: {
  jsonBodyLimitBytes: number;
}): Router {
  const router = Router();
  const parseJson = json({ limit: options.jsonBodyLimitBytes });

  router.post("/assets", upload.single("file"), async (request, response, next) => {
    try {
      if (!request.file) {
        sendApiError(
          response,
          400,
          "请选择扩展名、MIME 和内容一致的 PNG 或 JPEG 图片。",
          "IMAGE_REQUIRED"
        );
        return;
      }
      const validation = validateWorkspacePathRequest(request.body);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "WORKSPACE_PATH_INVALID");
        return;
      }
      const { assetDir } = await requireCurrentWorkspace(validation.value.workspacePath);
      response.json(await saveQuestionAsset(request.file, assetDir));
    } catch (error) {
      next(error);
    }
  });

  router.post("/compile-item", parseJson, async (request, response, next) => {
    try {
      const validation = validateCompileItemRequest(request.body);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "COMPILE_REQUEST_INVALID");
        return;
      }
      const { workspaceDir, tempDir } = await requireCurrentWorkspace(validation.value.workspacePath);
      const { item, settings } = validation.value;
      const result = await withLatexExecutionSlot(async (session) => {
        const texPath = await writeCurrentItemCheck(item, settings, workspaceDir);
        return compileLatex(texPath, path.dirname(texPath), 45_000, session);
      });
      response.status(result.ok ? 200 : 422).json({
        ...result,
        texUrl: toPublicTempUrl(result.texPath, tempDir),
        pdfUrl: result.pdfPath ? toPublicTempUrl(result.pdfPath, tempDir) : undefined
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/export", parseJson, async (request, response, next) => {
    try {
      const validation = validateExportRequest(request.body);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "EXPORT_REQUEST_INVALID");
        return;
      }
      const snapshot = await readBankSnapshot();
      if (snapshot.workspacePath !== path.resolve(validation.value.workspacePath)) {
        throw new StorageError("导出目标已不是当前工作区。", "WORKSPACE_CHANGED", 409);
      }
      if (snapshot.revision !== validation.value.baseRevision) {
        throw new StorageError("题库内容已变化，请重新导出。", "BANK_CONFLICT", 409);
      }
      const result = await exportBank(
        snapshot.bank,
        snapshot.workspacePath,
        validation.value
      );
      response.status(result.ok ? 200 : 422).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/exports/default-name", async (_request, response, next) => {
    try {
      response.json({ exportName: await getDefaultExportName() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/exports/reveal", parseJson, async (request, response, next) => {
    try {
      const validation = validateRevealExportRequest(request.body);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "EXPORT_REVEAL_REQUEST_INVALID");
        return;
      }
      await revealCurrentExportDirectory(validation.value.exportName);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function requireCurrentWorkspace(workspacePath: string) {
  const dirs = await getCurrentWorkspaceDirs();
  if (dirs.workspaceDir !== path.resolve(workspacePath)) {
    throw new StorageError("编译目标已不是当前工作区。", "WORKSPACE_CHANGED", 409);
  }
  return dirs;
}

function toPublicTempUrl(filePath: string, tempDir: string): string {
  const relative = path
    .relative(tempDir, filePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/");
  return `/tmp/${relative}`;
}
