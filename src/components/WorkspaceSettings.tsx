import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FolderInput,
  FolderPlus,
  Trash2
} from "lucide-react";
import { useWorkspace } from "../context/questionBankContexts.js";
import settings from "./SettingsScreen.module.css";
import styles from "./WorkspaceSettings.module.css";

export function WorkspaceSettings() {
  const workspace = useWorkspace();
  const appInfo = workspace.appInfo;
  if (!appInfo) return null;

  return (
    <section className={settings.section} aria-labelledby="workspace-settings-title">
      <header>
        <div>
          <h2 id="workspace-settings-title">工作区</h2>
          <p>创建、切换和整理保存在本机的题库工作区。</p>
        </div>
      </header>
      <div className={styles.workspaceBody}>
        <div className={styles.currentWorkspace}>
          <div className={styles.workspaceTitle}>
            <span>当前工作区</span>
            <strong title={appInfo.currentWorkspacePath}>
              {appInfo.currentWorkspaceName}
            </strong>
          </div>
          <div className={styles.workspaceActions}>
            <WorkspaceAction
              icon={<FolderPlus size={16} />}
              label="新建"
              title="新建空工作区"
              onClick={() => void workspace.createNewWorkspace()}
              disabled={workspace.isChangingWorkspace}
            />
            <WorkspaceAction
              icon={<FolderInput size={16} />}
              label="打开"
              title="打开已有工作区"
              onClick={() => void workspace.openWorkspace()}
              disabled={workspace.isChangingWorkspace}
            />
            <WorkspaceAction
              icon={<ExternalLink size={16} />}
              label="显示"
              title="在文件管理器中显示当前工作区"
              onClick={workspace.openCurrentWorkspaceFolder}
              disabled={!appInfo.currentWorkspacePath}
            />
          </div>
        </div>
        <div className={styles.workspaceList}>
          <span className={styles.workspaceListHeader}>最近工作区</span>
          {appInfo.recentWorkspaces.map((item, index) => (
            <div
              className={[
                styles.workspaceListItem,
                item.path === appInfo.currentWorkspacePath
                  ? styles.activeWorkspace
                  : "",
                item.exists ? "" : styles.missingWorkspace
              ].filter(Boolean).join(" ")}
              key={item.path}
            >
              <button
                className={styles.workspaceListMain}
                type="button"
                onClick={() => void workspace.switchToWorkspace(item.path)}
                disabled={
                  workspace.isChangingWorkspace ||
                  !item.exists ||
                  item.path === appInfo.currentWorkspacePath
                }
                title={item.path}
              >
                <strong>{item.name}</strong>
                <small>{item.exists ? "本地工作区" : "路径缺失"}</small>
              </button>
              <div className={styles.workspaceListControls}>
                {!item.exists && (
                  <MiniButton
                    label="重新定位工作区"
                    onClick={() => void workspace.relocateWorkspace(item.path)}
                    disabled={workspace.isChangingWorkspace}
                  >
                    <FolderInput size={14} />
                  </MiniButton>
                )}
                <MiniButton
                  label="上移工作区"
                  onClick={() => void workspace.moveWorkspaceInList(item.path, "up")}
                  disabled={index === 0 || workspace.isChangingWorkspace}
                >
                  <ArrowUp size={14} />
                </MiniButton>
                <MiniButton
                  label="下移工作区"
                  onClick={() => void workspace.moveWorkspaceInList(item.path, "down")}
                  disabled={
                    index === appInfo.recentWorkspaces.length - 1 ||
                    workspace.isChangingWorkspace
                  }
                >
                  <ArrowDown size={14} />
                </MiniButton>
                <MiniButton
                  label="删除工作区"
                  danger
                  onClick={() => void workspace.deleteWorkspace(item.path)}
                  disabled={workspace.isChangingWorkspace}
                >
                  <Trash2 size={14} />
                </MiniButton>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkspaceAction(props: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      className={styles.workspaceActionButton}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function MiniButton(props: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`${styles.miniIconButton} ${props.danger ? styles.danger : ""}`}
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
    >
      {props.children}
    </button>
  );
}
