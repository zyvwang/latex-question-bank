import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEmptyWorkspace,
  createSampleWorkspace as createSampleWorkspaceRequest,
  moveWorkspace,
  openExistingWorkspace,
  removeWorkspace,
  saveTexPath,
  switchWorkspace as switchWorkspaceRequest
} from "../api/client.js";
import type { AppInfo, Bank } from "../../shared/types.js";
import type { Notice } from "./controllerTypes.js";

interface WorkspaceActionsOptions {
  appInfo: AppInfo | null;
  bank: Bank | null;
  persistBank: (bank: Bank) => Promise<void>;
  reloadWorkspace: (appInfo: AppInfo) => Promise<void>;
  setAppInfo: (appInfo: AppInfo) => void;
  setNotice: (notice: Notice | null) => void;
}

export function useWorkspaceActions({
  appInfo,
  bank,
  persistBank,
  reloadWorkspace,
  setAppInfo,
  setNotice
}: WorkspaceActionsOptions) {
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  const initialTexPath = appInfo?.appState.texPathOverride ?? "";
  const [texPathDraft, setTexPathDraftState] = useState(initialTexPath);
  const texPathDraftRef = useRef(initialTexPath);
  const persistedTexPathRef = useRef(initialTexPath);
  const pendingTexPathRef = useRef<string | null>(null);
  const inFlightTexPathRef = useRef<string | null>(null);
  const texPathSavePromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const persisted = appInfo?.appState.texPathOverride ?? "";
    persistedTexPathRef.current = persisted;
    if (!texPathSavePromiseRef.current && pendingTexPathRef.current === null) {
      texPathDraftRef.current = persisted;
      setTexPathDraftState(persisted);
    }
  }, [appInfo?.appState.texPathOverride]);

  const setTexPathDraft = useCallback((value: string) => {
    texPathDraftRef.current = value;
    setTexPathDraftState(value);
  }, []);

  const drainTexPathSaves = useCallback((): Promise<void> => {
    if (texPathSavePromiseRef.current) return texPathSavePromiseRef.current;

    const operation = (async () => {
      while (pendingTexPathRef.current !== null) {
        const value = pendingTexPathRef.current;
        pendingTexPathRef.current = null;
        if (value === persistedTexPathRef.current) continue;

        inFlightTexPathRef.current = value;
        try {
          const nextAppInfo = await saveTexPath(value);
          persistedTexPathRef.current =
            nextAppInfo.appState.texPathOverride ?? "";
          if (texPathDraftRef.current.trim() === value) {
            texPathDraftRef.current = persistedTexPathRef.current;
            setTexPathDraftState(persistedTexPathRef.current);
          }
          setAppInfo(nextAppInfo);
          setNotice({
            type: nextAppInfo.texStatus.available ? "ok" : "error",
            text: nextAppInfo.texStatus.message
          });
        } catch (error) {
          if (
            pendingTexPathRef.current !== null &&
            pendingTexPathRef.current !== value
          ) {
            continue;
          }
          const message =
            error instanceof Error ? error.message : "保存 LaTeX 路径失败。";
          setNotice({ type: "error", text: message });
          throw error instanceof Error ? error : new Error(message);
        } finally {
          inFlightTexPathRef.current = null;
        }
      }
    })();

    const trackedOperation = operation.finally(() => {
      if (texPathSavePromiseRef.current === trackedOperation) {
        texPathSavePromiseRef.current = null;
      }
    });
    texPathSavePromiseRef.current = trackedOperation;
    return trackedOperation;
  }, [setAppInfo, setNotice]);

  const queueTexPathSave = useCallback(
    (value: string): Promise<void> => {
      if (
        value === persistedTexPathRef.current &&
        !texPathSavePromiseRef.current &&
        inFlightTexPathRef.current === null
      ) {
        pendingTexPathRef.current = null;
        return Promise.resolve();
      }
      pendingTexPathRef.current = value;
      return drainTexPathSaves();
    },
    [drainTexPathSaves]
  );

  const saveTexPathOverride = useCallback(() => {
    return queueTexPathSave(texPathDraftRef.current.trim());
  }, [queueTexPathSave]);

  const flushPendingSettings = useCallback(async () => {
    await queueTexPathSave(texPathDraftRef.current.trim());
    while (texPathSavePromiseRef.current) {
      await texPathSavePromiseRef.current;
    }
  }, [queueTexPathSave]);

  async function saveBeforeWorkspaceChange() {
    await Promise.all([
      flushPendingSettings(),
      bank && appInfo?.currentWorkspacePath
        ? persistBank(bank)
        : Promise.resolve()
    ]);
  }

  async function createSampleWorkspace() {
    const workspacePath = await pickWorkspaceDirectory(
      "选择示例工作区文件夹",
      "输入示例工作区文件夹路径，例如 /Users/me/Documents/LaTeX Question Bank/Sample Bank"
    );
    if (!workspacePath?.trim()) return;
    setIsChangingWorkspace(true);
    try {
      const nextAppInfo = await createSampleWorkspaceRequest(workspacePath);
      await reloadWorkspace(nextAppInfo);
      setNotice({ type: "ok", text: `已创建示例工作区：${nextAppInfo.currentWorkspaceName}` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "创建示例工作区失败。" });
    } finally {
      setIsChangingWorkspace(false);
    }
  }

  async function createNewWorkspace() {
    const workspacePath = await pickWorkspaceDirectory(
      "选择新工作区文件夹",
      "输入新工作区文件夹路径，例如 /Users/me/Documents/LaTeX Question Bank/My Bank"
    );
    if (!workspacePath?.trim()) return;
    setIsChangingWorkspace(true);
    try {
      await saveBeforeWorkspaceChange();
      const nextAppInfo = await createEmptyWorkspace(workspacePath);
      await reloadWorkspace(nextAppInfo);
      setNotice({ type: "ok", text: `已创建工作区：${nextAppInfo.currentWorkspaceName}` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "创建工作区失败。" });
    } finally {
      setIsChangingWorkspace(false);
    }
  }

  async function openWorkspace() {
    const workspacePath = await pickWorkspaceDirectory(
      "打开已有工作区",
      "输入题库工作区文件夹路径，例如 /Users/me/Documents/LaTeX Question Bank/My Bank"
    );
    if (!workspacePath?.trim()) return;
    if (workspacePath === appInfo?.currentWorkspacePath) return;
    setIsChangingWorkspace(true);
    try {
      await saveBeforeWorkspaceChange();
      const nextAppInfo = await openExistingWorkspace(workspacePath);
      await reloadWorkspace(nextAppInfo);
      setNotice({ type: "ok", text: `已打开工作区：${nextAppInfo.currentWorkspaceName}` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "打开工作区失败。" });
    } finally {
      setIsChangingWorkspace(false);
    }
  }

  async function switchToWorkspace(workspacePath: string) {
    if (!workspacePath || workspacePath === appInfo?.currentWorkspacePath) return;
    setIsChangingWorkspace(true);
    try {
      await saveBeforeWorkspaceChange();
      const nextAppInfo = await switchWorkspaceRequest(workspacePath);
      await reloadWorkspace(nextAppInfo);
      setNotice({ type: "ok", text: `已切换至：${nextAppInfo.currentWorkspaceName}` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "切换工作区失败。" });
    } finally {
      setIsChangingWorkspace(false);
    }
  }

  async function relocateWorkspace(workspacePath: string) {
    const replacementPath = await pickWorkspaceDirectory(
      "重新定位题库工作区",
      "输入该题库工作区的新路径"
    );
    if (!replacementPath?.trim()) return;
    setIsChangingWorkspace(true);
    try {
      await saveBeforeWorkspaceChange();
      await openExistingWorkspace(replacementPath);
      const nextAppInfo = await removeWorkspace(workspacePath);
      await reloadWorkspace(nextAppInfo);
      setNotice({ type: "ok", text: `已重新定位至：${nextAppInfo.currentWorkspaceName}` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "重新定位工作区失败。" });
    } finally {
      setIsChangingWorkspace(false);
    }
  }

  async function moveWorkspaceInList(workspacePath: string, direction: "up" | "down") {
    try {
      const nextAppInfo = await moveWorkspace(workspacePath, direction);
      setAppInfo(nextAppInfo);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "移动工作区失败。" });
    }
  }

  async function removeWorkspaceFromList(workspacePath: string) {
    const workspace = appInfo?.recentWorkspaces.find((item) => item.path === workspacePath);
    const name = workspace?.name ?? workspacePath;
    const message =
      `确定要从列表移除工作区“${name}”吗？\n\n磁盘上的工作区文件夹和 bank.json 会保持不变。`;
    if (!window.confirm(message)) return;

    setIsChangingWorkspace(true);
    try {
      if (workspacePath === appInfo?.currentWorkspacePath) {
        await saveBeforeWorkspaceChange();
      }
      const nextAppInfo = await removeWorkspace(workspacePath);
      await reloadWorkspace(nextAppInfo);
      setNotice({ type: "ok", text: `已从列表移除工作区：${name}；磁盘文件保持不变。` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "移除工作区记录失败。" });
    } finally {
      setIsChangingWorkspace(false);
    }
  }

  function openCurrentWorkspaceFolder() {
    if (!appInfo?.currentWorkspacePath) return;
    if (window.lqb?.openPath) {
      void window.lqb.openPath(appInfo.currentWorkspacePath);
      return;
    }
    setNotice({ type: "info", text: appInfo.currentWorkspacePath });
  }

  return {
    isChangingWorkspace,
    texPathDraft,
    setTexPathDraft,
    createSampleWorkspace,
    createNewWorkspace,
    openWorkspace,
    switchToWorkspace,
    relocateWorkspace,
    moveWorkspaceInList,
    removeWorkspaceFromList,
    saveTexPathOverride,
    flushPendingSettings,
    openCurrentWorkspaceFolder
  };
}

export async function pickWorkspaceDirectory(
  title: string,
  fallbackPrompt: string
): Promise<string | null> {
  if (window.lqb?.selectWorkspaceDirectory) {
    return window.lqb.selectWorkspaceDirectory(title);
  }
  return window.prompt(fallbackPrompt);
}
