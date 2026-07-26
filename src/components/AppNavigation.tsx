import { AlertTriangle, Check, Save } from "lucide-react";
import {
  useAppView,
  useLifecycle,
  useWorkspace
} from "../context/questionBankContexts.js";
import styles from "./AppNavigation.module.css";

export function AppNavigation() {
  const appView = useAppView();
  const lifecycle = useLifecycle();
  const workspace = useWorkspace();
  return (
    <header className={styles.navigation}>
      <div className={styles.identity}>
        <img src="/brand/icon-64.png" width="32" height="32" alt="" />
        <div>
          <strong>LaTeX 题库</strong>
          <span>{workspace.appInfo?.currentWorkspaceName ?? "未设置"}</span>
        </div>
      </div>
      <nav aria-label="题库页面">
        <button
          className={appView.activeView === "editor" ? styles.active : ""}
          aria-current={appView.activeView === "editor" ? "page" : undefined}
          onClick={() => appView.setActiveView("editor")}
        >
          编辑
        </button>
        <button
          className={appView.activeView === "heatmap" ? styles.active : ""}
          aria-current={appView.activeView === "heatmap" ? "page" : undefined}
          onClick={() => appView.setActiveView("heatmap")}
        >
          热力图
        </button>
        <button
          className={appView.activeView === "settings" ? styles.active : ""}
          aria-current={appView.activeView === "settings" ? "page" : undefined}
          onClick={() => appView.setActiveView("settings")}
        >
          题库设置
        </button>
      </nav>
      <div className={styles.status}>
        {appView.activeView === "settings" && lifecycle.notice && (
          <span
            className={`${styles.notice} ${styles[lifecycle.notice.type]}`}
            title={lifecycle.notice.text}
          >
            {lifecycle.notice.text}
          </span>
        )}
        <span className={`${styles.saveState} ${styles[lifecycle.saveState]}`}>
          {lifecycle.saveState === "saving" ? (
            <Save size={15} />
          ) : lifecycle.saveState === "error" ? (
            <AlertTriangle size={15} />
          ) : (
            <Check size={15} />
          )}
          {lifecycle.saveState === "saving"
            ? "保存中"
            : lifecycle.saveState === "error"
              ? "保存失败"
              : "已保存"}
        </span>
      </div>
    </header>
  );
}
