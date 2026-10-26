import { contextBridge, ipcRenderer } from "electron";
import type { UiLayoutPreferences } from "../shared/ui-layout-preferences.js";

const beforeCloseListeners = new Set<() => Promise<void>>();

ipcRenderer.on("app:before-close", (_event, requestId: unknown) => {
  if (typeof requestId !== "string" || !requestId) return;
  void Promise.all([...beforeCloseListeners].map((listener) => listener()))
    .then(() => ipcRenderer.send("app:close-response", { ok: true, requestId }))
    .catch((error) => {
      ipcRenderer.send("app:close-response", {
        ok: false,
        requestId,
        error: error instanceof Error ? error.message : "保存失败。"
      });
    });
});

contextBridge.exposeInMainWorld("lqb", {
  platform: process.platform,
  selectWorkspaceDirectory: (title?: string) =>
    ipcRenderer.invoke("workspace:select-directory", title) as Promise<string | null>,
  openPath: (targetPath: string) => ipcRenderer.invoke("shell:open-path", targetPath) as Promise<string>,
  revealExportFolder: (exportName: string) =>
    ipcRenderer.invoke("shell:reveal-export", exportName) as Promise<boolean>,
  openExternal: (targetUrl: string) =>
    ipcRenderer.invoke("shell:open-external", targetUrl) as Promise<boolean>,
  readUiLayoutPreferences: () =>
    ipcRenderer.invoke("ui-layout:read") as Promise<UiLayoutPreferences>,
  saveUiLayoutPreferences: (preferences: UiLayoutPreferences) =>
    ipcRenderer.invoke("ui-layout:write", preferences) as Promise<UiLayoutPreferences>,
  onBeforeClose: (listener: () => Promise<void>) => {
    beforeCloseListeners.add(listener);
    return () => beforeCloseListeners.delete(listener);
  }
});
