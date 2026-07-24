import type { AppInfo } from "../shared/types.js";
import { detectTexInstallation } from "./latex-runtime.js";
import {
  listRecentWorkspaces,
  readAppState,
  workspaceNameFromPath
} from "./workspace-storage.js";

export async function buildAppInfo(): Promise<AppInfo> {
  const appState = await readAppState();
  const currentWorkspacePath = appState.currentWorkspacePath ?? "";
  return {
    appState,
    currentWorkspaceName: currentWorkspacePath
      ? workspaceNameFromPath(currentWorkspacePath)
      : "未设置",
    currentWorkspacePath,
    recentWorkspaces: await listRecentWorkspaces(),
    texStatus: await detectTexInstallation(),
    isDesktop: process.env.LQB_DESKTOP === "1",
    setupRequired: !currentWorkspacePath
  };
}
