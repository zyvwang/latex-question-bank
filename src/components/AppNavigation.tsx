import { AlertTriangle, BarChart3, Check, CheckSquare, Files, PenLine, Save, SlidersHorizontal } from "lucide-react";
import {
  useAppView,
  useLifecycle,
  useQuestions,
  useWorkspace
} from "../context/questionBankContexts.js";
import { useLayoutPreferences } from "../context/layoutPreferences.js";
import styles from "./AppNavigation.module.css";

export function AppNavigation() {
  const appView = useAppView();
  const layout = useLayoutPreferences();
  const lifecycle = useLifecycle();
  const workspace = useWorkspace();
  const questions = useQuestions();
  const pendingCount =
    questions.bank?.items.filter(
      (item) => item.reviewStatus === "pending"
    ).length ?? 0;
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
          <PenLine size={18} aria-hidden="true" />
          <span>编辑</span>
        </button>
        <button
          className={appView.activeView === "review" ? styles.active : ""}
          aria-current={appView.activeView === "review" ? "page" : undefined}
          onClick={() => appView.setActiveView("review")}
        >
          <CheckSquare size={18} aria-hidden="true" />
          <span>待审阅</span>
          {pendingCount > 0 && (
            <span className={styles.reviewCount}>{pendingCount}</span>
          )}
        </button>
        <button
          className={appView.activeView === "distribution" ? styles.active : ""}
          aria-current={appView.activeView === "distribution" ? "page" : undefined}
          onClick={() => appView.setActiveView("distribution")}
        >
          <BarChart3 size={18} aria-hidden="true" />
          <span>复习分布</span>
        </button>
        <button className={appView.activeView === "papers" ? styles.active : ""}
          aria-current={appView.activeView === "papers" ? "page" : undefined}
          onClick={() => appView.setActiveView("papers")}>
          <Files size={18} aria-hidden="true" /><span>组卷</span>
        </button>
        <button
          className={appView.activeView === "settings" ? styles.active : ""}
          aria-current={appView.activeView === "settings" ? "page" : undefined}
          onClick={() => appView.setActiveView("settings")}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>题库设置</span>
        </button>
      </nav>
      <div className={styles.status}>
        {layout.persistError && (
          <span role="status">
            <button
              type="button"
              className={`${styles.saveState} ${styles.layoutError}`}
              title={layout.persistError}
              onClick={() => void layout.retryPersist().catch(() => undefined)}
            >
              <AlertTriangle size={15} />
              布局未保存 · 重试
            </button>
          </span>
        )}
        {appView.activeView === "settings" && lifecycle.notice && (
          <span
            className={`${styles.notice} ${styles[lifecycle.notice.type]}`}
            title={lifecycle.notice.text}
          >
            {lifecycle.notice.text}
          </span>
        )}
        {lifecycle.saveState === "conflict" ? (
          <button
            type="button"
            className={`${styles.saveState} ${styles.conflict}`}
            onClick={lifecycle.openConflictDialog}
          >
            <AlertTriangle size={15} />
            保存冲突 · 处理
          </button>
        ) : lifecycle.saveState === "error" ? (
          <button
            type="button"
            className={`${styles.saveState} ${styles.error}`}
            aria-label="重试保存"
            onClick={() => void lifecycle.retrySave()}
          >
            <AlertTriangle size={15} />
            保存失败 · 重试
          </button>
        ) : (
          <span
            className={`${styles.saveState} ${
              styles[lifecycle.saveState]
            }`}
          >
            {lifecycle.saveState === "saving" ? (
              <Save size={15} />
            ) : (
              <Check size={15} />
            )}
            {lifecycle.saveState === "saving"
              ? "保存中"
              : "已保存"}
          </span>
        )}
      </div>
    </header>
  );
}
