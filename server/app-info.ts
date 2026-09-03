import type { AppInfo, AppState } from "../shared/types.js";
import { detectTexInstallation } from "./latex-runtime.js";
import {
  listRecentWorkspaces,
  readAppState,
  workspaceNameFromPath
} from "./workspace-storage.js";

export async function buildAppInfo(committedState?: AppState): Promise<AppInfo> {
  const appState = committedState ?? (await readAppState());
  const currentWorkspacePath = appState.currentWorkspacePath ?? "";
  return {
    appState,
    currentWorkspaceName: currentWorkspacePath
      ? workspaceNameFromPath(currentWorkspacePath)
      : "未设置",
    currentWorkspacePath,
    recentWorkspaces: await listRecentWorkspaces(appState),
    texStatus: await detectTexInstallation(appState.texPathOverride ?? null),
    isDesktop: process.env.LQB_DESKTOP === "1",
    setupRequired: !currentWorkspacePath
  };
}
