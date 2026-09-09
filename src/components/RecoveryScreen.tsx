import { FolderOpen, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useLifecycle, useWorkspace } from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./SetupScreen.module.css";

export function RecoveryScreen() {
  const lifecycle = useLifecycle();
  const workspace = useWorkspace();
  const currentWorkspacePath = workspace.appInfo?.currentWorkspacePath ?? "";
  const currentWorkspace = workspace.appInfo?.recentWorkspaces.find(
    (candidate) => candidate.path === currentWorkspacePath
  );
  const currentWorkspaceMissing = currentWorkspace?.exists === false;
  const availableRecentWorkspaces =
    workspace.appInfo?.recentWorkspaces.filter(
      (candidate) =>
        candidate.exists && candidate.path !== currentWorkspacePath
    ) ?? [];
  const reportError = (error: unknown, fallback: string) =>
    lifecycle.setNotice({ type: "error", text: error instanceof Error ? error.message : fallback });
  const run = (operation: Promise<void>, fallback: string) => {
    void operation.catch((error) => reportError(error, fallback));
  };
  if (!workspace.appInfo) return (
    <main className={styles.setupShell}>
      <section className={styles.setupPanel}>
        <div className={styles.setupCopy}>
          <h1>应用信息加载失败</h1>
          <p role="alert">{lifecycle.loadError}</p>
        </div>
        <div className={styles.setupActions}>
          <button className={controls.primaryAction} onClick={() => run(lifecycle.retryInitialLoad(), "重新读取失败。")}>
            <RefreshCw size={18} />重试
          </button>
        </div>
      </section>
    </main>
  );
  return (
    <main className={styles.setupShell}>
      <section className={`${styles.setupPanel} ${styles.recoveryPanel}`}>
        <div className={styles.setupCopy}>
          <span>{currentWorkspaceMissing ? "工作区不可用" : "题库读取失败"}</span>
          <h1>
            {currentWorkspaceMissing
              ? "原题库位置已失效"
              : "磁盘数据没有被覆盖"}
          </h1>
          <p>
            {currentWorkspaceMissing
              ? "找不到当前工作区中的 bank.json。工作区记录仍然保留，你可以重新定位或切换到其他题库。"
              : lifecycle.loadError}
          </p>
        </div>
        <div className={styles.setupActions}>
          {currentWorkspaceMissing ? (
            <>
              <button
                className={controls.primaryAction}
                disabled={workspace.isChangingWorkspace}
                onClick={() => run(workspace.openWorkspace(), "打开工作区失败。")}
              >
                <FolderOpen size={18} />选择其他工作区
              </button>
              <button
                className={controls.secondaryAction}
                disabled={workspace.isChangingWorkspace}
                onClick={() => run(
                  workspace.relocateWorkspace(currentWorkspacePath),
                  "重新定位工作区失败。"
                )}
              >
                <FolderOpen size={18} />重新定位
              </button>
              <button
                className={controls.tertiaryAction}
                disabled={workspace.isChangingWorkspace}
                onClick={() => run(lifecycle.retryInitialLoad(), "重新读取失败。")}
              >
                <RefreshCw size={18} />重试
              </button>
              <button
                className={`${controls.tertiaryAction} ${controls.danger}`}
                disabled={workspace.isChangingWorkspace}
                onClick={() => run(
                  workspace.removeWorkspaceFromList(currentWorkspacePath),
                  "移除失效记录失败。"
                )}
              >
                <Trash2 size={18} />移除失效记录
              </button>
            </>
          ) : (
            <>
              <button
                className={controls.primaryAction}
                onClick={() => run(lifecycle.retryInitialLoad(), "重新读取失败。")}
              >
                <RefreshCw size={18} />重试
              </button>
              <button
                className={controls.secondaryAction}
                disabled={workspace.isChangingWorkspace}
                onClick={() => run(workspace.openWorkspace(), "打开工作区失败。")}
              >
                <FolderOpen size={18} />选择其他工作区
              </button>
              <button
                className={controls.secondaryAction}
                onClick={workspace.openCurrentWorkspaceFolder}
              >
                <FolderOpen size={18} />在访达中查看
              </button>
            </>
          )}
        </div>
        {availableRecentWorkspaces.length > 0 && (
          <div className={styles.recoveryList}>
            <strong>
              {currentWorkspaceMissing
                ? "可用的最近工作区"
                : "切换到其他题库"}
            </strong>
            {availableRecentWorkspaces.map((candidate) => (
              <button
                key={candidate.path}
                className={controls.secondaryAction}
                disabled={workspace.isChangingWorkspace}
                onClick={() => run(
                  workspace.switchToWorkspace(candidate.path),
                  "切换工作区失败。"
                )}
              >
                <FolderOpen size={16} />切换到 {candidate.name}
              </button>
            ))}
          </div>
        )}
        {lifecycle.recoveryCandidates.length > 0 && (
          <div className={styles.recoveryList}>
            <strong>可恢复版本</strong>
            {lifecycle.recoveryCandidates.map((candidate) => (
              <button
                key={candidate.id}
                className={controls.secondaryAction}
                onClick={() => void lifecycle.recoverFromCandidate(candidate.id).catch((error) => reportError(error, "恢复失败。"))}
              >
                <RotateCcw size={16} />{candidate.label}
              </button>
            ))}
          </div>
        )}
        {lifecycle.notice && <p className={`${styles.setupNotice} ${styles[lifecycle.notice.type]}`}>{lifecycle.notice.text}</p>}
      </section>
    </main>
  );
}
