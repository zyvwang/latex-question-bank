import { useEffect, useState } from "react";
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
  const [texPathDraft, setTexPathDraft] = useState("");

  useEffect(() => {
    setTexPathDraft(appInfo?.appState.texPathOverride ?? "");
  }, [appInfo?.appState.texPathOverride]);

  async function saveBeforeWorkspaceChange() {
    if (bank && appInfo?.currentWorkspacePath) {
      await persistBank(bank);
    }
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

  async function deleteWorkspace(workspacePath: string) {
    const workspace = appInfo?.recentWorkspaces.find((item) => item.path === workspacePath);
    const name = workspace?.name ?? workspacePath;
    const canTrash = Boolean(window.lqb?.trashPath && workspace?.exists);
    const message = canTrash
      ? `确定要删除工作区“${name}”吗？\n\n工作区文件夹会移到废纸篓/回收站，并从列表移除。`
      : `确定要从列表移除工作区“${name}”吗？\n\n当前环境不能移动文件夹到废纸篓，磁盘文件不会被删除。`;
    if (!window.confirm(message)) return;

    setIsChangingWorkspace(true);
    try {
      if (workspacePath === appInfo?.currentWorkspacePath) {
        await saveBeforeWorkspaceChange();
      }
      if (canTrash && window.lqb?.trashPath) {
        await window.lqb.trashPath(workspacePath);
      }
      const nextAppInfo = await removeWorkspace(workspacePath);
      await reloadWorkspace(nextAppInfo);
      setNotice({ type: "ok", text: canTrash ? `已删除工作区：${name}` : `已移除工作区记录：${name}` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "删除工作区失败。" });
    } finally {
      setIsChangingWorkspace(false);
    }
  }

  async function saveTexPathOverride() {
    try {
      const nextAppInfo = await saveTexPath(texPathDraft);
      setAppInfo(nextAppInfo);
      setNotice({
        type: nextAppInfo.texStatus.available ? "ok" : "error",
        text: nextAppInfo.texStatus.message
      });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "保存 LaTeX 路径失败。" });
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
    deleteWorkspace,
    saveTexPathOverride,
    openCurrentWorkspaceFolder
  };
}

async function pickWorkspaceDirectory(title: string, fallbackPrompt: string): Promise<string | null> {
  if (window.lqb?.selectWorkspaceDirectory) {
    return window.lqb.selectWorkspaceDirectory(title);
  }
  return window.prompt(fallbackPrompt);
}
