import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { appDataDir } from "../../server/app-state.js";
import {
  createEmptyWorkspace,
  isKnownWorkspacePath
} from "../../server/workspace-storage.js";

const workspacePath = path.resolve(".tmp/vitest-electron-workspace");
const unrelatedPath = path.resolve(".tmp/vitest-electron-unrelated");

beforeEach(async () => {
  await rm(appDataDir, { recursive: true, force: true });
  await rm(workspacePath, { recursive: true, force: true });
  await rm(unrelatedPath, { recursive: true, force: true });
});

describe("Electron shell path allowlist", () => {
  it("allows only current or recent workspace roots", async () => {
    await createEmptyWorkspace(workspacePath);
    await expect(isKnownWorkspacePath(workspacePath)).resolves.toBe(true);
    await expect(isKnownWorkspacePath(path.join(workspacePath, "bank.json"))).resolves.toBe(false);
    await expect(isKnownWorkspacePath(unrelatedPath)).resolves.toBe(false);
  });

  it("keeps preload sandboxing and navigation restrictions enabled", async () => {
    const mainSource = await readFile(path.resolve("electron/main.ts"), "utf8");
    const preloadSource = await readFile(path.resolve("electron/preload.cts"), "utf8");
    expect(mainSource).toContain("contextIsolation: true");
    expect(mainSource).toContain("nodeIntegration: false");
    expect(mainSource).toContain("sandbox: true");
    expect(mainSource).toContain("setWindowOpenHandler");
    expect(mainSource).toContain("assertTrustedSender");
    expect(mainSource).toContain('ipcMain.handle("shell:reveal-export"');
    expect(mainSource).toContain('ipcMain.on("app:close-response"');
    expect(mainSource).toContain("quitRequested = true");
    expect(preloadSource).toContain('contextBridge.exposeInMainWorld("lqb"');
    expect(preloadSource).toContain("revealExportFolder");
    expect(preloadSource).not.toContain("ipcRenderer:");
  });

  it("keeps development boot compatible without weakening packaged storage", async () => {
    const mainSource = await readFile(path.resolve("electron/main.ts"), "utf8");
    const packageMetadata = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
      build?: { extraMetadata?: { lqbUseMockKeychain?: boolean } };
      scripts?: { "dist:mac"?: string };
    };
    const viteSource = await readFile(path.resolve("vite.config.ts"), "utf8");
    const serverMiddlewareSource = await readFile(
      path.resolve("server/http/middleware.ts"),
      "utf8"
    );
    const previewSource = await readFile(path.resolve("src/utils/preview.ts"), "utf8");

    expect(viteSource).toContain("script-src 'self' 'unsafe-inline'");
    expect(viteSource).toContain("worker-src 'self' blob:");
    expect(serverMiddlewareSource).toContain("worker-src 'self' blob:");
    expect(previewSource).toContain('fonts: "/vendor/mathjax-fonts"');
    expect(mainSource).toContain("if (isDevelopment)");
    expect(mainSource).toContain("if (configuredAppDataDir)");
    expect(mainSource).toContain("function shouldUseMockKeychain()");
    expect(mainSource).toContain("packageMetadata.lqbUseMockKeychain === true");
    expect(mainSource).toContain('app.setPath("sessionData"');
    expect(mainSource).toContain('app.commandLine.appendSwitch("use-mock-keychain")');
    expect(packageMetadata.build?.extraMetadata?.lqbUseMockKeychain).toBe(true);
    expect(packageMetadata.scripts?.["dist:mac"]).toContain("cleanup-macos-unpacked.mjs");
  });
});
