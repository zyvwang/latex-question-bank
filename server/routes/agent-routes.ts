import { Router, json } from "express";
import multer from "multer";
import {
  validateAgentImportManifest
} from "../../shared/agent-manifest.js";
import {
  validateAgentTagJournal,
  validateAgentTagManifest
} from "../../shared/agent-tags.js";
import { validateWorkspacePathRequest } from "../../shared/request-validation.js";
import { ValidationError } from "../../shared/validation-primitives.js";
import { applyAgentImport } from "../agent-import-service.js";
import { applyAgentTags, undoAgentTags } from "../agent-tag-service.js";
import { undoAgentImport } from "../agent-undo-service.js";
import { requireAgentToken } from "../agent-auth.js";
import {
  agentRuntimeAppVersion,
  refreshAgentDiscovery
} from "../agent-discovery.js";
import {
  createAgentWorkspace,
  parseAgentWorkspaceCreateInput
} from "../agent-workspace-service.js";
import { buildAppInfo } from "../app-info.js";
import { readBankSnapshot } from "../bank-storage.js";
import { sendApiError } from "../http/api-response.js";
import { switchWorkspace } from "../workspace-storage.js";

const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8",
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 40,
    fields: 10,
    fieldSize: 8 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    callback(null, ["image/png", "image/jpeg"].includes(file.mimetype));
  }
});

export function createAgentRouter(options: {
  jsonBodyLimitBytes: number;
}): Router {
  const router = Router();
  router.use("/agent", requireAgentToken);

  router.get("/agent/status", async (_request, response, next) => {
    try {
      const snapshot = await readBankSnapshot();
      const appInfo = await buildAppInfo();
      response.json({
        appVersion: agentRuntimeAppVersion(),
        workspacePath: snapshot.workspacePath,
        workspaceName: appInfo.currentWorkspaceName,
        setupRequired: appInfo.setupRequired,
        revision: snapshot.revision,
        pendingCount: snapshot.bank.items.filter(
          (item) => item.reviewStatus === "pending"
        ).length,
        books: snapshot.bank.books.map((book) => ({
          id: book.id,
          title: book.title
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/agent/import",
    upload.array("assets", 40),
    async (request, response, next) => {
      try {
        const body = request.body as Record<string, unknown>;
        const createBank = body.createBank === "true";
        const workspacePath = createBank
          ? optionalString(body, "workspacePath") ?? ""
          : requiredString(body, "workspacePath");
        const manifestText = requiredString(body, "manifest");
        let manifestValue: unknown;
        try {
          manifestValue = JSON.parse(manifestText);
        } catch {
          throw new ValidationError("manifest 不是有效的 JSON。");
        }
        const validation = validateAgentImportManifest(manifestValue);
        if (!validation.ok || !validation.value) {
          throw new ValidationError(validation.error ?? "导入清单无效。");
        }
        const files = (request.files as Express.Multer.File[] | undefined) ?? [];
        const summary = await applyAgentImport({
          workspacePath,
          manifest: validation.value,
          files: files.map((file) => ({
            buffer: file.buffer,
            mimetype: file.mimetype,
            originalname: file.originalname,
            size: file.size
          })),
          dryRun: body.dryRun === "true",
          overwrite: body.overwrite === "true",
          createBank,
          switchWorkspace: body.switchWorkspace === "true",
          baseRevision:
            typeof body.baseRevision === "string" && body.baseRevision.trim()
              ? body.baseRevision.trim()
              : undefined
        });
        response.json(summary);
      } catch (error) {
        if (error instanceof ValidationError) {
          sendApiError(
            response,
            400,
            error.message,
            "AGENT_MANIFEST_INVALID"
          );
          return;
        }
        next(error);
      }
    }
  );

  router.post(
    "/agent/undo",
    json({ limit: options.jsonBodyLimitBytes }),
    async (request, response, next) => {
      try {
        const body = request.body as Record<string, unknown>;
        const summary = await undoAgentImport({
          batchId: requiredString(body, "batchId"),
          workspacePath: optionalString(body, "workspacePath"),
          baseRevision: optionalString(body, "baseRevision")
        });
        response.json(summary);
      } catch (error) {
        if (error instanceof ValidationError) {
          sendApiError(
            response,
            400,
            error.message,
            "UNDO_REQUEST_INVALID"
          );
          return;
        }
        next(error);
      }
    }
  );

  router.post(
    "/agent/tags",
    json({ limit: options.jsonBodyLimitBytes }),
    async (request, response, next) => {
      try {
        const body = request.body as Record<string, unknown>;
        const validation = validateAgentTagManifest(body.manifest);
        if (!validation.ok || !validation.value) {
          throw new ValidationError(validation.error ?? "标签清单无效。");
        }
        const summary = await applyAgentTags({
          workspacePath: requiredString(body, "workspacePath"),
          manifest: validation.value,
          dryRun: optionalBoolean(body, "dryRun"),
          baseRevision: optionalString(body, "baseRevision")
        });
        response.json(summary);
      } catch (error) {
        if (error instanceof ValidationError) {
          sendApiError(response, 400, error.message, "AGENT_TAGS_INVALID");
          return;
        }
        next(error);
      }
    }
  );

  router.post(
    "/agent/tags/undo",
    json({ limit: options.jsonBodyLimitBytes }),
    async (request, response, next) => {
      try {
        const body = request.body as Record<string, unknown>;
        const validation = validateAgentTagJournal(body.journal);
        if (!validation.ok || !validation.value) {
          throw new ValidationError(validation.error ?? "撤销记录无效。");
        }
        const summary = await undoAgentTags({
          workspacePath: requiredString(body, "workspacePath"),
          journal: validation.value,
          dryRun: optionalBoolean(body, "dryRun"),
          baseRevision: optionalString(body, "baseRevision")
        });
        response.json(summary);
      } catch (error) {
        if (error instanceof ValidationError) {
          sendApiError(response, 400, error.message, "AGENT_TAGS_INVALID");
          return;
        }
        next(error);
      }
    }
  );

  router.post(
    "/agent/workspaces/create",
    json({ limit: options.jsonBodyLimitBytes }),
    async (request, response, next) => {
      try {
        const input = parseAgentWorkspaceCreateInput(request.body);
        const created = await createAgentWorkspace(input);
        response.json({
          workspacePath: created.workspacePath,
          snapshot: created.snapshot,
          switched: created.switched,
          ...(created.switched ? { appInfo: await buildAppInfo() } : {})
        });
      } catch (error) {
        if (error instanceof ValidationError) {
          sendApiError(
            response,
            400,
            error.message,
            "AGENT_WORKSPACE_INVALID"
          );
          return;
        }
        next(error);
      }
    }
  );

  router.post(
    "/agent/workspaces/switch",
    json({ limit: options.jsonBodyLimitBytes }),
    async (request, response, next) => {
      try {
        const validation = validateWorkspacePathRequest(request.body);
        if (!validation.ok || !validation.value) {
          sendApiError(
            response,
            400,
            validation.error ?? "缺少工作区路径。",
            "WORKSPACE_PATH_INVALID"
          );
          return;
        }
        const transition = await switchWorkspace(validation.value.workspacePath);
        await refreshAgentDiscovery(
          transition.appState.currentWorkspacePath
        ).catch((error) => {
          console.warn("刷新 Agent 发现文件失败。", error);
        });
        response.json({
          appInfo: await buildAppInfo(transition.appState),
          snapshot: transition.snapshot
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

function requiredString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${key} 必须是非空字符串。`);
  }
  return value.trim();
}

// dryRun 写错类型（比如字符串 "true"）时不能当成「不是预演」而真的写入，直接拒绝。
function optionalBoolean(
  record: Record<string, unknown>,
  key: string
): boolean {
  const value = record[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new ValidationError(`${key} 必须是布尔值。`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}
