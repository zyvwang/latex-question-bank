import { useLatestCallback } from "./useLatestCallback.js";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  fetchAppInfo,
  fetchBank,
  waitForWorkspaceWrites,
  createEmptyWorkspace,
  createSampleWorkspace as createSampleWorkspaceRequest,
  moveWorkspace,
  openExistingWorkspace,
  relocateWorkspace as relocateWorkspaceRequest,
  removeWorkspace,
  saveTexPath,
  switchWorkspace as switchWorkspaceRequest
} from "../api/client.js";
import type {
  AppInfo,
  WorkspaceTransitionResponse
} from "../../shared/types.js";
import type { Notice } from "./controllerTypes.js";

interface WorkspaceActionsOptions {
  appInfo: AppInfo | null;
  persistCurrentBank: () => Promise<void>;
  hasPendingUploads: () => boolean;
  changingRef: { current: boolean };
  applyWorkspaceTransition: (response: WorkspaceTransitionResponse) => void;
  setAppInfo: (appInfo: AppInfo) => void;
  setNotice: (notice: Notice | null) => void;
}

export function useWorkspaceActions({
  appInfo,
  persistCurrentBank,
  hasPendingUploads,
  changingRef,
  applyWorkspaceTransition,
  setAppInfo,
  setNotice
}: WorkspaceActionsOptions) {
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  const unresolvedRef = useRef(false);
  const [isWorkspaceUncertain, setIsWorkspaceUncertain] = useState(false);
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
    if (unresolvedRef.current) throw new Error("工作区操作结果尚未确认，请先核对后退出。");
    await queueTexPathSave(texPathDraftRef.current.trim());
    while (texPathSavePromiseRef.current) {
      await texPathSavePromiseRef.current;
    }
  }, [queueTexPathSave]);

  const runWorkspaceChange = useLatestCallback(async (operation: () => Promise<void>) => {
    if (changingRef.current) return;
    if (hasPendingUploads()) {
      setNotice({ type: "error", text: "图片仍在上传，请等待上传完成后切换工作区。" });
      return;
    }
    changingRef.current = true;
    setIsChangingWorkspace(true);
    try {
      if (unresolvedRef.current) {
        await reconcileWorkspace();
        return;
      }
      await operation();
    } catch (error) {
      await handleWorkspaceError(error);
    } finally {
      changingRef.current = false;
      setIsChangingWorkspace(false);
    }
  });

  async function reconcileWorkspace() {
    await waitForWorkspaceWrites();
    const nextAppInfo = await fetchAppInfo();
    const snapshot = nextAppInfo.setupRequired ? null : await fetchBank();
    if (snapshot && snapshot.workspacePath !== nextAppInfo.currentWorkspacePath) {
      throw new Error("工作区仍在变化，请重试核对。");
    }
    flushSync(() => applyWorkspaceTransition({ appInfo: nextAppInfo, snapshot }));
    unresolvedRef.current = false;
    setIsWorkspaceUncertain(false);
    setNotice({ type: "ok", text: "已核对当前工作区，请继续操作。" });
  }

  async function handleWorkspaceError(error: unknown) {
    if (error instanceof ApiRequestError && error.code === "WRITE_RESULT_UNKNOWN" &&
        (error.requestUrl?.startsWith("/api/workspaces/") || error.requestUrl === "/api/recovery")) {
      unresolvedRef.current = true;
      setIsWorkspaceUncertain(true);
      try {
        await reconcileWorkspace();
        return;
      } catch {
        setNotice({ type: "error", text: "操作结果尚未确认，请点击“核对工作区状态”。当前内容已保留。" });
        return;
      }
    }
    setNotice({ type: "error", text: error instanceof Error ? error.message : "工作区操作失败。" });
  }

  async function saveBeforeWorkspaceChange() {
    await Promise.all([
      flushPendingSettings(),
      persistCurrentBank()
    ]);
  }

  async function createSampleWorkspace() {
    return runWorkspaceChange(async () => {
      const workspacePath = await pickWorkspaceDirectory(
        "选择示例工作区文件夹",
        "输入示例工作区文件夹路径，例如 /Users/me/Documents/LaTeX Question Bank/Sample Bank"
      );
      if (!workspacePath?.trim()) return;
      try {
        await saveBeforeWorkspaceChange();
        const response = await createSampleWorkspaceRequest(workspacePath);
        flushSync(() => applyWorkspaceTransition(response));
        setNotice({
          type: "ok",
          text: `已创建示例工作区：${response.appInfo.currentWorkspaceName}`
        });
      } catch (error) {
        await handleWorkspaceError(error);
      }
    });
  }

  async function createNewWorkspace() {
    return runWorkspaceChange(async () => {
      const workspacePath = await pickWorkspaceDirectory(
        "选择新工作区文件夹",
        "输入新工作区文件夹路径，例如 /Users/me/Documents/LaTeX Question Bank/My Bank"
      );
      if (!workspacePath?.trim()) return;
      try {
        await saveBeforeWorkspaceChange();
        const response = await createEmptyWorkspace(workspacePath);
        flushSync(() => applyWorkspaceTransition(response));
        setNotice({
          type: "ok",
          text: `已创建工作区：${response.appInfo.currentWorkspaceName}`
        });
      } catch (error) {
        await handleWorkspaceError(error);
      }
    });
  }

  async function openWorkspace() {
    return runWorkspaceChange(async () => {
      const workspacePath = await pickWorkspaceDirectory(
        "打开已有工作区",
        "输入题库工作区文件夹路径，例如 /Users/me/Documents/LaTeX Question Bank/My Bank"
      );
      if (!workspacePath?.trim()) return;
      if (workspacePath === appInfo?.currentWorkspacePath) return;
      try {
        await saveBeforeWorkspaceChange();
        const response = await openExistingWorkspace(workspacePath);
        flushSync(() => applyWorkspaceTransition(response));
        setNotice({
          type: "ok",
          text: `已打开工作区：${response.appInfo.currentWorkspaceName}`
        });
      } catch (error) {
        await handleWorkspaceError(error);
      }
    });
  }

  async function switchToWorkspace(workspacePath: string) {
    return runWorkspaceChange(async () => {
      if (!workspacePath || workspacePath === appInfo?.currentWorkspacePath) return;
      try {
        await saveBeforeWorkspaceChange();
        const response = await switchWorkspaceRequest(workspacePath);
        flushSync(() => applyWorkspaceTransition(response));
        setNotice({
          type: "ok",
          text: `已切换至：${response.appInfo.currentWorkspaceName}`
        });
      } catch (error) {
        await handleWorkspaceError(error);
      }
    });
  }

  async function relocateWorkspace(workspacePath: string) {
    return runWorkspaceChange(async () => {
      const replacementPath = await pickWorkspaceDirectory(
        "重新定位题库工作区",
        "输入该题库工作区的新路径"
      );
      if (!replacementPath?.trim()) return;
      try {
        await saveBeforeWorkspaceChange();
        const response = await relocateWorkspaceRequest(
          workspacePath,
          replacementPath
        );
        flushSync(() => applyWorkspaceTransition(response));
        setNotice({
          type: "ok",
          text: `已重新定位至：${response.appInfo.currentWorkspaceName}`
        });
      } catch (error) {
        await handleWorkspaceError(error);
      }
    });
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
    return runWorkspaceChange(async () => {
      const workspace = appInfo?.recentWorkspaces.find((item) => item.path === workspacePath);
      const name = workspace?.name ?? workspacePath;
      const message =
        `确定要从列表移除工作区“${name}”吗？\n\n磁盘上的工作区文件夹和 bank.json 会保持不变。`;
      if (!window.confirm(message)) return;

      try {
        if (workspacePath === appInfo?.currentWorkspacePath) {
          await saveBeforeWorkspaceChange();
        }
        const response = await removeWorkspace(workspacePath);
        flushSync(() => applyWorkspaceTransition(response));
        setNotice({ type: "ok", text: `已从列表移除工作区：${name}；磁盘文件保持不变。` });
      } catch (error) {
        setNotice({ type: "error", text: error instanceof Error ? error.message : "移除工作区记录失败。" });
      }
    });
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
    isWorkspaceUncertain,
    runWorkspaceChange,
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
