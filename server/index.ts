import express from "express";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  apiErrorHandler,
  contentSecurityPolicy,
  dynamicWorkspaceStatic,
  installFrontend,
  rejectForeignHosts,
  rejectForeignMutatingOrigins
} from "./http/middleware.js";
import { createBankRouter } from "./routes/bank-routes.js";
import { createDocumentRouter } from "./routes/document-routes.js";
import { createAgentRouter } from "./routes/agent-routes.js";
import { createEventsRouter } from "./routes/events-routes.js";
import { createWorkspaceRouter } from "./routes/workspace-routes.js";
import {
  configureAgentDiscovery,
  refreshAgentDiscovery,
  removeAgentDiscovery
} from "./agent-discovery.js";
import { getAgentToken } from "./agent-auth.js";
import { closeEventClients } from "./events.js";
import { ensureProjectDirs } from "./workspace-storage.js";
import {
  BANK_SAVE_BODY_LIMIT_BYTES,
  DEFAULT_JSON_BODY_LIMIT_BYTES
} from "../shared/api-limits.js";

export interface ApiServerOptions {
  host?: string;
  port?: number;
  appVersion?: string;
}

export interface ApiAppOptions {
  bankBodyLimitBytes?: number;
  jsonBodyLimitBytes?: number;
}

export interface StartedApiServer {
  app: express.Express;
  server: Server;
  url: string;
  port: number;
}

export function createApiApp(options: ApiAppOptions = {}): express.Express {
  const app = express();
  const bankBodyLimitBytes =
    options.bankBodyLimitBytes ?? BANK_SAVE_BODY_LIMIT_BYTES;
  const jsonBodyLimitBytes =
    options.jsonBodyLimitBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
  getAgentToken();
  app.use(rejectForeignHosts);
  app.use(contentSecurityPolicy);
  app.use(rejectForeignMutatingOrigins);
  app.use("/assets", dynamicWorkspaceStatic("assetDir"));
  app.use("/tmp", dynamicWorkspaceStatic("tempDir"));
  app.use(
    "/api",
    createWorkspaceRouter({ bankBodyLimitBytes, jsonBodyLimitBytes })
  );
  app.use(
    "/api",
    createBankRouter({ bankBodyLimitBytes, jsonBodyLimitBytes })
  );
  app.use("/api", createDocumentRouter({ jsonBodyLimitBytes }));
  app.use("/api", createAgentRouter({ jsonBodyLimitBytes }));
  app.use("/api", createEventsRouter());
  installFrontend(app);
  app.use(apiErrorHandler);
  return app;
}

export async function startApiServer(
  options: ApiServerOptions = {}
): Promise<StartedApiServer> {
  await ensureProjectDirs();
  const app = createApiApp();
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? Number(process.env.PORT ?? 5174);

  return new Promise((resolve, reject) => {
    const server = app.listen(requestedPort, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : requestedPort;
      const url = `http://${host}:${port}`;
      configureAgentDiscovery({
        port,
        appVersion: options.appVersion
      });
      void refreshAgentDiscovery().catch((error) => {
        console.warn("写入 Agent 发现文件失败。", error);
      });
      console.log(`API server listening on ${url}`);
      resolve({ app, server, url, port });
    });
    server.on("error", reject);
    server.on("close", () => {
      closeEventClients();
      void removeAgentDiscovery();
    });
  });
}

function isDirectRun(): boolean {
  const currentFile = fileURLToPath(import.meta.url);
  return Boolean(process.argv[1] && path.resolve(process.argv[1]) === currentFile);
}

if (isDirectRun()) {
  await startApiServer();
}
