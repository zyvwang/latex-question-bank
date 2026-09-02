import express from "express";
import multer from "multer";
import path from "node:path";
import { AssetUploadError } from "../asset-service.js";
import { rootDir } from "../app-state.js";
import { StorageError } from "../storage-types.js";
import { resolveRealWorkspaceFile } from "../workspace-paths.js";
import { getCurrentWorkspaceDirs } from "../workspace-storage.js";
import { sendApiError } from "./api-response.js";
import {
  BANK_PAYLOAD_TOO_LARGE_CODE,
  BANK_PAYLOAD_TOO_LARGE_MESSAGE
} from "../../shared/api-limits.js";

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
    if (!["GET", "HEAD"].includes(request.method.toUpperCase())) {
      next();
      return;
    }
    try {
      const dirs = await getCurrentWorkspaceDirs();
      const relativePath = decodeWorkspaceStaticPath(request.path);
      if (
        !relativePath ||
        relativePath.split(/[\\/]/).some((segment) => segment.startsWith("."))
      ) {
        next();
        return;
      }
      const filePath = await resolveRealWorkspaceFile(
        dirs[dirKey],
        relativePath,
        { allowMissing: true }
      );
      response.sendFile(filePath, { dotfiles: "allow" }, (error) => {
        if (!error) return;
        if (isStaticFileMissing(error) && !response.headersSent) {
          next();
          return;
        }
        next(error);
      });
    } catch (error) {
      // 按 code 判断,不按文案:改一个字就会让静态资源路由开始抛 500。
      if (
        error instanceof StorageError &&
        error.code === "WORKSPACE_NOT_SELECTED"
      ) {
        next();
        return;
      }
      next(error);
    }
  };
}

function decodeWorkspaceStaticPath(requestPath: string): string {
  try {
    return decodeURIComponent(requestPath).replace(/^\/+/, "");
  } catch {
    throw new StorageError(
      "工作区文件路径编码无效。",
      "WORKSPACE_ENTRY_INVALID"
    );
  }
}

function isStaticFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))) ||
      ("status" in error && error.status === 404))
  );
}

export function installFrontend(app: express.Express) {
  app.use(express.static(path.join(rootDir, "dist")));
  app.use((request, response, next) => {
    // 未匹配的 /api 路径不能落到 SPA 兜底:客户端会拿到 200 text/html,
    // response.json() 抛 SyntaxError,而只看 response.ok 的调用方会当成成功。
    if (request.path.startsWith("/api/")) {
      sendApiError(response, 404, "接口不存在。", "API_NOT_FOUND");
      return;
    }
    if (
      request.path === "/assets" ||
      request.path.startsWith("/assets/") ||
      request.path === "/tmp" ||
      request.path.startsWith("/tmp/")
    ) {
      response.sendStatus(404);
      return;
    }
    if (request.method !== "GET") {
      next();
      return;
    }
    response.sendFile(path.join(rootDir, "dist", "index.html"));
  });
}

export function apiErrorHandler(
  error: unknown,
  request: express.Request,
  response: express.Response,
  _next: express.NextFunction
) {
  if (isEntityTooLarge(error)) {
    const pathname = new URL(
      request.originalUrl,
      "http://localhost"
    ).pathname;
    const isBankSave =
      (request.method === "PUT" && pathname === "/api/bank") ||
      (request.method === "POST" &&
        pathname === "/api/workspaces/save-as");
    sendApiError(
      response,
      413,
      isBankSave
        ? BANK_PAYLOAD_TOO_LARGE_MESSAGE
        : "请求体超过允许的大小。",
      isBankSave
        ? BANK_PAYLOAD_TOO_LARGE_CODE
        : "REQUEST_PAYLOAD_TOO_LARGE"
    );
    return;
  }
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
  // 未分类错误的 message 常带绝对路径等主机细节,只写日志,不回给客户端。
  console.error(error);
  sendApiError(response, 500, "服务器内部错误。", "INTERNAL_ERROR");
}

function isMutatingMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isLoopbackHostname(hostname: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(hostname);
}

function isEntityTooLarge(
  error: unknown
): error is Error & { type: "entity.too.large" } {
  return (
    error instanceof Error &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}
