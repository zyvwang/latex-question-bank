import { contextBridge, ipcRenderer } from "electron";

const beforeCloseListeners = new Set<() => Promise<void>>();

ipcRenderer.on("app:before-close", () => {
  void Promise.all([...beforeCloseListeners].map((listener) => listener()))
    .then(() => ipcRenderer.send("app:close-response", { ok: true }))
    .catch((error) => {
      ipcRenderer.send("app:close-response", {
        ok: false,
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
  trashPath: (targetPath: string) => ipcRenderer.invoke("shell:trash-path", targetPath) as Promise<boolean>,
  openExternal: (targetUrl: string) =>
    ipcRenderer.invoke("shell:open-external", targetUrl) as Promise<boolean>,
  onBeforeClose: (listener: () => Promise<void>) => {
    beforeCloseListeners.add(listener);
    return () => beforeCloseListeners.delete(listener);
  }
});
