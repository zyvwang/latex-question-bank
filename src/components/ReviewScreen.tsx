import { useEffect, type ReactNode } from "react";
import { useAppView, useWorkspace } from "../context/questionBankContexts.js";
import {
  useQuestions,
  useSelection
} from "../context/questionBankContexts.js";
import { useVariantQueue } from "../hooks/useVariantQueue.js";
import controls from "../styles/controls.module.css";
import { EditorLayout } from "./EditorLayout.js";
import { VariantReviewQueue } from "./VariantReviewQueue.js";
import styles from "./ReviewScreen.module.css";

export function ReviewScreen() {
  const workspace = useWorkspace().appInfo?.currentWorkspacePath ?? "";
  const appView = useAppView();
  const { queue, reload, pause } = useVariantQueue(workspace);
  const totalPending = useQuestions().bank?.items.filter((item) => item.reviewStatus === "pending").length ?? 0;
  const tab = appView.reviewTab;

  // The version system stays invisible until the user switches it on.
  if (!queue?.enabled) return <OriginalsReview />;

  const switcher: ReactNode = (
    <nav className={styles.tabs} aria-label="审阅内容">
      {([["originals", `原题 ${totalPending}`], ["versions", `版本 ${queue.total}`]] as const).map(([id, label]) => (
        <button key={id} type="button" aria-pressed={tab === id} onClick={() => appView.setReviewTab(id)}>{label}</button>
      ))}
    </nav>
  );
  return (
    <div className={styles.shell}>
      {switcher}
      <div className={styles.body}>
        {tab === "versions"
          ? <VariantReviewQueue workspace={workspace} queue={queue} reload={reload} pause={pause} />
          : <OriginalsReview />}
      </div>
    </div>
  );
}

function OriginalsReview() {
  const questions = useQuestions();
  const selection = useSelection();
  const appView = useAppView();
  const pending = selection.filteredItems;
  const { activeId, activeItem, setActiveId } = questions;

  useEffect(() => {
    if (!pending.length) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (
      !activeItem ||
      !pending.some((item) => item.id === activeItem.id)
    ) {
      setActiveId(pending[0].id);
    }
  }, [activeId, activeItem, pending, setActiveId]);

  const totalPending =
    questions.bank?.items.filter(
      (item) => item.reviewStatus === "pending"
    ).length ?? 0;
  if (!pending.length) {
    return (
      <section className={styles.empty} id="main-workspace" aria-label="待审阅">
        <div className={styles.emptyCard}>
          <h1>
            {totalPending > 0
              ? "当前筛选没有待审阅题目"
              : "没有待审阅题目"}
          </h1>
          <p>
            {totalPending > 0
              ? "还有待审阅题目被其他筛选条件隐藏了。"
              : "Agent 导入的新题会出现在这里；批准后即可回到编辑页继续整理。"}
          </p>
          {totalPending > 0 ? (
            <button
              type="button"
              className={controls.secondaryAction}
              onClick={selection.clearFilters}
            >
              清除筛选
            </button>
          ) : (
            <button
              type="button"
              className={controls.primaryAction}
              onClick={() => appView.setActiveView("editor")}
            >
              返回编辑
            </button>
          )}
        </div>
      </section>
    );
  }

  return <EditorLayout mode="review" />;
}
