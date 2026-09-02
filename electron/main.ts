import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { mkdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyExternalUrl,
  classifySender,
  createSecureWebPreferences,
  isCloseResponse,
  navigationIsAllowed,
  type RendererCloseResponse
} from "./security-policy.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.LQB_DEV_SERVER_URL);
const configuredAppDataDir = process.env.LQB_APP_DATA_DIR?.trim();
const useMockKeychain = shouldUseMockKeychain();

app.setName("LaTeX Question Bank");

if (configuredAppDataDir) {
  const appDataDir = path.resolve(configuredAppDataDir);
  const sessionDataDir = path.join(appDataDir, "session");
  mkdirSync(sessionDataDir, { recursive: true });
  app.setPath("userData", appDataDir);
  app.setPath("sessionData", sessionDataDir);
} else if (isDevelopment) {
  const sessionDataDir = path.join(app.getPath("temp"), "latex-question-bank-electron-session");
  mkdirSync(sessionDataDir, { recursive: true });
  app.setPath("sessionData", sessionDataDir);
}

if (useMockKeychain) {
  app.commandLine.appendSwitch("use-mock-keychain");
}

let mainWindow: BrowserWindow | null = null;
let apiServer: Server | null = null;
let apiServerUrl: string | null = null;
let allowWindowClose = false;
let closeCheckPending = false;
let closeCheckTimer: NodeJS.Timeout | null = null;
let quitRequested = false;
let allowAppQuit = false;
let mainWindowCreation: Promise<BrowserWindow> | null = null;

const isPrimaryInstance = app.requestSingleInstanceLock();

async function createWindow(): Promise<BrowserWindow> {
  process.env.LQB_DESKTOP = "1";
  process.env.LQB_APP_DATA_DIR = app.getPath("userData");
  process.env.LQB_ROOT_DIR = app.getAppPath();

  if (!apiServer || !apiServerUrl) {
    const { startApiServer } = await import("../server/index.js");
    const api = await startApiServer({ port: isDevelopment ? 5174 : 0 });
    apiServer = api.server;
    apiServerUrl = api.url;
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 720,
    title: "LaTeX 题库",
    backgroundColor: "#f7f5ef",
    webPreferences: createSecureWebPreferences(
      path.join(currentDir, "preload.cjs")
    )
  });

  const appUrl = process.env.LQB_DEV_SERVER_URL || apiServerUrl;
  const trustedOrigin = new URL(appUrl).origin;
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!navigationIsAllowed(targetUrl, trustedOrigin)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyExternalUrl(url, appUrl) !== "blocked") {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.on("close", (event) => {
    if (allowWindowClose) return;
    event.preventDefault();
    requestRendererCloseCheck();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    allowWindowClose = false;
    closeCheckPending = false;
    if (closeCheckTimer) clearTimeout(closeCheckTimer);
    closeCheckTimer = null;
    if (quitRequested) {
      allowAppQuit = true;
      app.quit();
    }
  });

  await mainWindow.loadURL(appUrl);
  return mainWindow;
}

async function showOrCreateMainWindow(): Promise<void> {
  await app.whenReady();
  const existingWindow =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (existingWindow) {
    mainWindow = existingWindow;
    if (existingWindow.isMinimized()) existingWindow.restore();
    if (!existingWindow.isVisible()) existingWindow.show();
    existingWindow.focus();
    return;
  }

  if (!mainWindowCreation) {
    mainWindowCreation = createWindow().finally(() => {
      mainWindowCreation = null;
    });
  }
  const window = await mainWindowCreation;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void showOrCreateMainWindow();
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin") {
      app.setAboutPanelOptions({
        applicationName: "LaTeX Question Bank",
        applicationVersion: app.getVersion(),
        copyright: "Copyright © 2026 LaTeX Question Bank contributors"
      });
    }
    registerIpcHandlers();
    app.on("activate", () => {
      void showOrCreateMainWindow();
    });
    await showOrCreateMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (!allowAppQuit && mainWindow && !mainWindow.isDestroyed()) {
      event.preventDefault();
      quitRequested = true;
      mainWindow.close();
      return;
    }
    apiServer?.close();
    apiServer = null;
    apiServerUrl = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("workspace:select-directory", async (event, title?: string) => {
    assertTrustedSender(event);
    const options: Electron.OpenDialogOptions = {
      title: title || "选择题库工作区",
      properties: ["openDirectory", "createDirectory"]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("shell:open-path", async (event, targetPath: string) => {
    assertTrustedSender(event);
    await assertKnownWorkspacePath(targetPath);
    return shell.openPath(targetPath);
  });

  ipcMain.handle("shell:reveal-export", async (event, exportName: string) => {
    assertTrustedSender(event);
    const { resolveCurrentExportDirectory } = await import("../server/export-directory-service.js");
    const error = await shell.openPath(await resolveCurrentExportDirectory(exportName));
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle("shell:open-external", async (event, targetUrl: string) => {
    assertTrustedSender(event);
    const localAppUrl = process.env.LQB_DEV_SERVER_URL || apiServerUrl;
    if (classifyExternalUrl(targetUrl, localAppUrl) === "blocked") {
      throw new Error("只允许打开本机链接或 HTTPS 链接。");
    }
    await shell.openExternal(targetUrl);
    return true;
  });

  ipcMain.handle("ui-layout:read", async (event) => {
    assertTrustedSender(event);
    const { readUiLayoutPreferences } = await import("../server/app-state.js");
    return readUiLayoutPreferences();
  });

  ipcMain.handle("ui-layout:write", async (event, preferences: unknown) => {
    assertTrustedSender(event);
    const { updateUiLayoutPreferences } = await import("../server/app-state.js");
    return updateUiLayoutPreferences(preferences);
  });

  ipcMain.on("app:close-response", (event, result: { ok: boolean; error?: string }) => {
    try {
      assertTrustedSender(event);
    } catch {
      return;
    }
    if (!isCloseResponse(result)) return;
    void handleRendererCloseResponse(result);
  });
}

async function assertKnownWorkspacePath(targetPath: string) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("缺少工作区路径。");
  }
  const { isKnownWorkspacePath } = await import("../server/storage.js");
  if (!(await isKnownWorkspacePath(targetPath))) {
    throw new Error("只能操作当前或最近使用过的工作区。");
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent) {
  const trust = classifySender({
    senderId: event.sender.id,
    expectedSenderId: mainWindow?.webContents.id ?? null,
    senderUrl: event.senderFrame?.url,
    currentUrl: mainWindow?.webContents.getURL()
  });
  if (trust === "wrong-window") {
    throw new Error("拒绝未知窗口的 IPC 请求。");
  }
  if (trust === "wrong-origin") {
    throw new Error("拒绝非本机页面的 IPC 请求。");
  }
}

function shouldUseMockKeychain(): boolean {
  if (process.platform !== "darwin") return false;
  if (!app.isPackaged) return true;

  try {
    const packageMetadata = JSON.parse(
      readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")
    ) as { lqbUseMockKeychain?: unknown };
    return packageMetadata.lqbUseMockKeychain === true;
  } catch {
    return false;
  }
}

function requestRendererCloseCheck() {
  if (!mainWindow || closeCheckPending) return;
  closeCheckPending = true;
  mainWindow.webContents.send("app:before-close");
  closeCheckTimer = setTimeout(async () => {
    if (!mainWindow || !closeCheckPending) return;
    // 必须在 await 之前就交出这一轮:对话框展示期间渲染端的 app:close-response
    // 仍会到达,它的 closeCheckPending 守卫要能挡住,否则叠出第二个对话框。
    closeCheckPending = false;
    closeCheckTimer = null;
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: "保存检查超时",
      message: "应用未能确认最后的修改已经保存。",
      buttons: ["返回继续编辑", "放弃未保存修改"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (choice.response === 1 && mainWindow) {
      allowWindowClose = true;
      mainWindow.close();
    } else {
      quitRequested = false;
    }
  }, 10_000);
}

function finishCloseCheckTimer() {
  if (closeCheckTimer) clearTimeout(closeCheckTimer);
  closeCheckTimer = null;
}

async function handleRendererCloseResponse(result: RendererCloseResponse) {
  if (!closeCheckPending || !mainWindow) return;
  // 同上:先交出这一轮再 await。preload 每收到一次 app:before-close 就回一次,
  // 重复的关闭请求不能在对话框上再叠一个。
  closeCheckPending = false;
  finishCloseCheckTimer();
  if (result.ok) {
    allowWindowClose = true;
    mainWindow.close();
    return;
  }

  const choice = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "尚未保存",
    message: "最后的修改未能保存。",
    detail: result.error || "请返回应用重试保存，或放弃未保存的修改。",
    buttons: ["返回继续编辑", "放弃未保存修改"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (choice.response === 1 && mainWindow) {
    allowWindowClose = true;
    mainWindow.close();
  } else {
    quitRequested = false;
  }
}
