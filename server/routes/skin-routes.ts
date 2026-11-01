import { Router, json } from "express";
import { SKIN_MAX_BYTES } from "../../shared/skins.js";
import { requireAgentToken } from "../agent-auth.js";
import { sendApiError } from "../http/api-response.js";
import { installSkin, listSkins, removeSkin, SkinError } from "../skin-storage.js";

export function createSkinRouter(): Router {
  const router = Router();
  router.get("/skins", async (_request, response, next) => {
    try { response.json(await listSkins()); } catch (error) { next(error); }
  });
  router.post("/agent/skins", requireAgentToken, json({ limit: SKIN_MAX_BYTES }), async (request, response, next) => {
    try {
      if (request.query.overwrite !== undefined && request.query.overwrite !== "true" && request.query.overwrite !== "false") throw new SkinError("SKIN_OVERWRITE", "overwrite: 使用 true 或 false。");
      response.json(await installSkin(request.body, request.query.overwrite === "true"));
    } catch (error) { next(error); }
  });
  router.delete("/agent/skins/:id", requireAgentToken, async (request, response, next) => {
    try { if (typeof request.params.id !== "string") throw new SkinError("SKIN_ID", "id: 使用单个皮肤 id。"); await removeSkin(request.params.id); response.json({ removed: request.params.id }); }
    catch (error) { next(error); }
  });
  router.use(((error, _request, response, next) => {
    if (error instanceof SkinError) { sendApiError(response, error.status, error.message, error.code); return; }
    if (error?.type === "entity.too.large") { sendApiError(response, 413, "skin: 缩减文件到 16 KiB 以内。", "SKIN_TOO_LARGE"); return; }
    if (error?.type === "entity.parse.failed") { sendApiError(response, 400, "skin: 修复 JSON 语法。", "SKIN_JSON"); return; }
    next(error);
  }) satisfies import("express").ErrorRequestHandler);
  return router;
}
