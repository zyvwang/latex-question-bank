import express from "express";
import multer from "multer";
import path from "node:path";
import { AssetUploadError } from "../asset-service.js";
import { rootDir } from "../app-state.js";
import { StorageError } from "../storage-types.js";
import { getCurrentWorkspaceDirs } from "../workspace-storage.js";
import { sendApiError } from "./api-response.js";

export function contentSecurityPolicy(
  _request: express.Request,
  response: express.Response,
  next: express.NextFunction
) {
  if (!process.env.LQB_DEV_SERVER_URL) {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
  }
  next();
}

export function rejectForeignMutatingOrigins(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
) {
  if (!isMutatingMethod(request.method)) {
    next();
    return;
  }
  const origin = request.get("origin");
  if (!origin) {
    next();
    return;
  }

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`${request.protocol}://${request.get("host")}`);
    const devOrigin = process.env.LQB_DEV_SERVER_URL
      ? new URL(process.env.LQB_DEV_SERVER_URL).origin
      : "";
    const allowedOrigins = new Set([requestUrl.origin, devOrigin].filter(Boolean));
    if (isLoopbackHostname(requestUrl.hostname) && allowedOrigins.has(originUrl.origin)) {
      next();
      return;
    }
  } catch {
    sendApiError(response, 403, "拒绝未知来源的写入请求。", "ORIGIN_INVALID");
    return;
  }
  sendApiError(response, 403, "拒绝非本机来源的写入请求。", "ORIGIN_FORBIDDEN");
}

export function dynamicWorkspaceStatic(
  dirKey: "assetDir" | "tempDir"
): express.RequestHandler {
  return async (request, response, next) => {
    try {
      const dirs = await getCurrentWorkspaceDirs();
      express.static(dirs[dirKey])(request, response, next);
    } catch (error) {
      if (error instanceof Error && error.message.includes("尚未选择题库工作区")) {
        next();
        return;
      }
      next(error);
    }
  };
}

export function installFrontend(app: express.Express) {
  app.use(express.static(path.join(rootDir, "dist")));
  app.use((request, response, next) => {
    if (request.method !== "GET") {
      next();
      return;
    }
    response.sendFile(path.join(rootDir, "dist", "index.html"));
  });
}

export function apiErrorHandler(
  error: unknown,
  _request: express.Request,
  response: express.Response,
  _next: express.NextFunction
) {
  if (error instanceof multer.MulterError) {
    sendApiError(response, 400, error.message, "UPLOAD_INVALID");
    return;
  }
  if (error instanceof AssetUploadError) {
    sendApiError(response, 400, error.message, error.code);
    return;
  }
  if (error instanceof StorageError) {
    sendApiError(response, error.status, error.message, error.code);
    return;
  }
  if (isClientInputError(error)) {
    sendApiError(response, 400, error.message, "REQUEST_INVALID");
    return;
  }
  console.error(error);
  sendApiError(
    response,
    500,
    error instanceof Error ? error.message : "服务器内部错误。",
    "INTERNAL_ERROR"
  );
}

function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isLoopbackHostname(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

function isClientInputError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  return [
    "该文件夹已经是题库工作区。",
    "这个文件夹不是题库工作区：缺少 bank.json。",
    "尚未选择题库工作区。"
  ].some((message) => error.message.startsWith(message));
}
