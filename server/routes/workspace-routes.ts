import { Router, json, type RequestHandler } from "express";
import {
  validateSaveBankAsRequest,
  validateTexPathRequest,
  validateWorkspaceMoveRequest,
  validateWorkspacePathRequest
} from "../../shared/validation.js";
import { updateTexPathOverride } from "../app-state.js";
import { buildAppInfo } from "../app-info.js";
import { saveBankAsWorkspace } from "../workspace-save-as.js";
import { sendApiError } from "../http/api-response.js";
import {
  createEmptyWorkspace,
  createSampleWorkspace,
  moveWorkspace,
  openExistingWorkspace,
  removeWorkspace,
  switchWorkspace
} from "../workspace-storage.js";

export function createWorkspaceRouter(options: {
  bankBodyLimitBytes: number;
  jsonBodyLimitBytes: number;
}): Router {
  const router = Router();
  const parseJson = json({ limit: options.jsonBodyLimitBytes });
  const parseBankJson = json({ limit: options.bankBodyLimitBytes });

  router.get("/app", async (_request, response, next) => {
    try {
      response.json(await buildAppInfo());
    } catch (error) {
      next(error);
    }
  });

  registerWorkspacePathRoute(
    router,
    parseJson,
    "/workspaces/create-sample",
    "缺少示例工作区路径。",
    async (path) => {
      await createSampleWorkspace(path);
    }
  );

  router.post(
    "/workspaces/save-as",
    parseBankJson,
    async (request, response, next) => {
      try {
        const validation = validateSaveBankAsRequest(request.body);
        if (!validation.ok || !validation.value) {
          sendApiError(
            response,
            400,
            validation.error,
            "WORKSPACE_SAVE_AS_INVALID"
          );
          return;
        }
        const snapshot = await saveBankAsWorkspace(validation.value);
        response.json({
          appInfo: await buildAppInfo(),
          snapshot
        });
      } catch (error) {
        next(error);
      }
    }
  );
  registerWorkspacePathRoute(
    router,
    parseJson,
    "/workspaces/create-empty",
    "缺少新工作区路径。",
    async (path) => {
      await createEmptyWorkspace(path);
    }
  );
  registerWorkspacePathRoute(
    router,
    parseJson,
    "/workspaces/open",
    undefined,
    async (path) => {
      await openExistingWorkspace(path);
    }
  );
  registerWorkspacePathRoute(
    router,
    parseJson,
    "/workspaces/remove",
    undefined,
    async (path) => {
      await removeWorkspace(path);
    }
  );
  registerWorkspacePathRoute(
    router,
    parseJson,
    "/workspaces/switch",
    undefined,
    async (path) => {
      await switchWorkspace(path);
    }
  );

  router.post("/workspaces/move", parseJson, async (request, response, next) => {
    try {
      const validation = validateWorkspaceMoveRequest(request.body);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "WORKSPACE_MOVE_INVALID");
        return;
      }
      await moveWorkspace(
        validation.value.workspacePath,
        validation.value.direction === "down" ? 1 : -1
      );
      response.json(await buildAppInfo());
    } catch (error) {
      next(error);
    }
  });

  router.post("/tex-path", parseJson, async (request, response, next) => {
    try {
      const validation = validateTexPathRequest(request.body);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "TEX_PATH_INVALID");
        return;
      }
      await updateTexPathOverride(validation.value.texPath);
      response.json(await buildAppInfo());
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function registerWorkspacePathRoute(
  router: Router,
  parseJson: RequestHandler,
  route: string,
  missingMessage: string | undefined,
  operation: (workspacePath: string) => Promise<void>
) {
  router.post(route, parseJson, async (request, response, next) => {
    try {
      const validation = validateWorkspacePathRequest(request.body, missingMessage);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "WORKSPACE_PATH_INVALID");
        return;
      }
      await operation(validation.value.workspacePath);
      response.json(await buildAppInfo());
    } catch (error) {
      next(error);
    }
  });
}
