import { Router, json, type RequestHandler } from "express";
import {
  validateSaveBankAsRequest,
  validateTexPathRequest,
  validateWorkspaceMoveRequest,
  validateWorkspacePathRequest,
  validateWorkspaceRelocateRequest
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
  relocateWorkspace,
  removeWorkspace,
  switchWorkspace,
  type WorkspaceTransition
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

  registerWorkspaceTransitionRoute(
    router,
    parseJson,
    "/workspaces/create-sample",
    "缺少示例工作区路径。",
    createSampleWorkspace
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
        const transition = await saveBankAsWorkspace(validation.value);
        response.json({
          appInfo: await buildAppInfo(transition.appState),
          snapshot: transition.snapshot
        });
      } catch (error) {
        next(error);
      }
    }
  );
  registerWorkspaceTransitionRoute(
    router,
    parseJson,
    "/workspaces/create-empty",
    "缺少新工作区路径。",
    createEmptyWorkspace
  );
  registerWorkspaceTransitionRoute(
    router,
    parseJson,
    "/workspaces/open",
    undefined,
    openExistingWorkspace
  );
  registerWorkspaceTransitionRoute(
    router,
    parseJson,
    "/workspaces/remove",
    undefined,
    removeWorkspace
  );
  registerWorkspaceTransitionRoute(
    router,
    parseJson,
    "/workspaces/switch",
    undefined,
    switchWorkspace
  );

  router.post(
    "/workspaces/relocate",
    parseJson,
    async (request, response, next) => {
      try {
        const validation = validateWorkspaceRelocateRequest(request.body);
        if (!validation.ok || !validation.value) {
          sendApiError(
            response,
            400,
            validation.error,
            "WORKSPACE_RELOCATE_INVALID"
          );
          return;
        }
        const transition = await relocateWorkspace(
          validation.value.workspacePath,
          validation.value.replacementPath
        );
        response.json(await buildWorkspaceTransitionResponse(transition));
      } catch (error) {
        next(error);
      }
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

function registerWorkspaceTransitionRoute(
  router: Router,
  parseJson: RequestHandler,
  route: string,
  missingMessage: string | undefined,
  operation: (workspacePath: string) => Promise<WorkspaceTransition>
) {
  router.post(route, parseJson, async (request, response, next) => {
    try {
      const validation = validateWorkspacePathRequest(request.body, missingMessage);
      if (!validation.ok || !validation.value) {
        sendApiError(response, 400, validation.error, "WORKSPACE_PATH_INVALID");
        return;
      }
      const transition = await operation(validation.value.workspacePath);
      response.json(await buildWorkspaceTransitionResponse(transition));
    } catch (error) {
      next(error);
    }
  });
}

async function buildWorkspaceTransitionResponse(
  transition: WorkspaceTransition
) {
  return {
    appInfo: await buildAppInfo(transition.appState),
    snapshot: transition.snapshot
  };
}
