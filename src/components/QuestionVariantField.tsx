import { Link2 } from "lucide-react";
import { questionSourceDisplay } from "../../shared/question-source.js";
import { useAppView, useQuestions, useSelection } from "../context/questionBankContexts.js";
import styles from "./WorkspaceView.module.css";

export function VariantField() {
  const questions = useQuestions();
  const selection = useSelection();
  const appView = useAppView();
  const item = questions.activeItem;
  if (!item?.variantOf) return null;
  const original =
    questions.bank?.items.find(
      (candidate) => candidate.id === item.variantOf
    ) ?? null;
  if (!original) {
    return (
      <div className={styles.contextField} aria-label="变式原题">
        <span>变式原题</span>
        <strong className={styles.variantMissing}>原题已删除</strong>
      </div>
    );
  }
  const display = questionSourceDisplay(
    original,
    questions.bank?.books ?? []
  );
  const originalId = original.id;
  const originalIsPending = original.reviewStatus === "pending";

  function openOriginal() {
    questions.setActiveId(originalId);
    const originalVisibleInReview =
      originalIsPending &&
      selection.filteredItems.some(
        (candidate) => candidate.id === originalId
      );
    if (appView.activeView === "review" && !originalVisibleInReview) {
      appView.setActiveView("editor");
    }
  }

  return (
    <div className={styles.contextField} aria-label="变式原题">
      <span>变式原题</span>
      <button
        type="button"
        className={styles.variantLink}
        onClick={openOriginal}
        title={`跳转到 ${display}`}
      >
        <Link2 size={14} />
        {display}
      </button>
    </div>
  );
}

