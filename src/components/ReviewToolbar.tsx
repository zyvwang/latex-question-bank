import { Check, CheckCircle2, ChevronRight, Trash2 } from "lucide-react";
import { questionSourceDisplay } from "../../shared/question-source.js";
import { useQuestions, useSelection } from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./ReviewToolbar.module.css";

export function ReviewToolbar() {
  const questions = useQuestions();
  const selection = useSelection();
  const pending = selection.filteredItems;
  const active = questions.activeItem;
  const activeIsPending =
    active !== null && pending.some((item) => item.id === active.id);

  function nextPending(excludeId: string | undefined): string | null {
    if (!excludeId) return pending[0]?.id ?? null;
    const index = pending.findIndex((item) => item.id === excludeId);
    if (index === -1) return pending[0]?.id ?? null;
    return pending[index + 1]?.id ?? pending[0]?.id ?? null;
  }

  function approveCurrent() {
    if (!active || !activeIsPending) return;
    const next = nextPending(active.id);
    questions.updateItem(active.id, { reviewStatus: "approved" });
    questions.setActiveId(next);
  }

  function nextKeepingPending() {
    const next = nextPending(active?.id);
    if (next) questions.setActiveId(next);
  }

  function deleteCurrent() {
    if (!active) return;
    questions.deleteItem(active.id);
  }

  function approveFiltered() {
    if (!pending.length) return;
    if (
      !window.confirm(
        `批准当前筛选的 ${pending.length} 道待审阅题？`
      )
    ) {
      return;
    }
    const ids = new Set(pending.map((item) => item.id));
    const now = new Date().toISOString();
    questions.updateBank((current) => ({
      ...current,
      items: current.items.map((item) =>
        ids.has(item.id)
          ? { ...item, reviewStatus: "approved", updatedAt: now }
          : item
      )
    }));
    questions.setActiveId(null);
  }

  return (
    <section className={styles.toolbar} aria-label="待审阅操作">
      <div className={styles.summary}>
        <strong>{`待审阅 ${pending.length} 道`}</strong>
        {active && (
          <span>
            {questionSourceDisplay(active, questions.bank?.books ?? [])}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={controls.primaryAction}
          disabled={!activeIsPending}
          onClick={approveCurrent}
        >
          <Check size={16} />
          批准并下一题
        </button>
        <button
          type="button"
          className={controls.secondaryAction}
          disabled={!activeIsPending}
          onClick={nextKeepingPending}
        >
          <ChevronRight size={16} />
          下一题
        </button>
        <button
          type="button"
          className={controls.secondaryAction}
          disabled={!active}
          onClick={deleteCurrent}
        >
          <Trash2 size={16} />
          删除
        </button>
        <button
          type="button"
          className={controls.secondaryAction}
          disabled={!pending.length}
          onClick={approveFiltered}
        >
          <CheckCircle2 size={16} />
          批准当前筛选
        </button>
      </div>
    </section>
  );
}
