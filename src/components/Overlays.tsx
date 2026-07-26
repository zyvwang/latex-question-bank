import { ListOrdered, Plus, Trash2 } from "lucide-react";
import {
  useQuestions,
  useReview,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import { oldestMasteryHistoryId } from "../review-history.js";
import controls from "../styles/controls.module.css";
import styles from "./Overlays.module.css";

export function Overlays() {
  const questions = useQuestions();
  const ui = useWorkspaceUi();
  return (
    <>
      {ui.reorderMenu && (
        <div
          className={styles.contextMenu}
          data-context-menu
          role="menu"
          aria-label="题目操作"
          style={{ left: ui.reorderMenu.x, top: ui.reorderMenu.y }}
        >
          <button role="menuitem" onClick={() => questions.addItem({ type: "insertAfter", afterId: ui.reorderMenu!.id })}>
            <Plus size={16} />在此题后插入
          </button>
          <button role="menuitem" onClick={() => questions.addItem({ type: "chapterEnd", afterId: ui.reorderMenu!.id })}>
            <Plus size={16} />在本章末插入
          </button>
          <button role="menuitem" onClick={() => ui.openReorderDialog(ui.reorderMenu!.id)}>
            <ListOrdered size={16} />更改题序至...
          </button>
          <button role="menuitem" className={styles.danger} onClick={() => questions.deleteItem(ui.reorderMenu!.id)}>
            <Trash2 size={16} />删除
          </button>
        </div>
      )}
      {ui.addMenu && (
        <div
          className={styles.contextMenu}
          data-context-menu
          role="menu"
          aria-label="新增题目"
          style={{ left: ui.addMenu.x, top: ui.addMenu.y }}
        >
          {questions.activeItem && (
            <button role="menuitem" onClick={() => questions.addItem({ type: "insertAfter", afterId: questions.activeItem!.id })}>
              <Plus size={16} />在当前题后插入
            </button>
          )}
          {questions.activeItem && (
            <button role="menuitem" onClick={() => questions.addItem({ type: "chapterEnd", afterId: questions.activeItem!.id })}>
              <Plus size={16} />在当前章末插入
            </button>
          )}
          <button role="menuitem" onClick={() => questions.addItem({ type: "append" })}>
            <Plus size={16} />在末尾插入（未分类）
          </button>
        </div>
      )}
      {ui.reorderDialogItem && <ReorderDialog />}
      <HistoryCapacityDialog />
    </>
  );
}

function HistoryCapacityDialog() {
  const review = useReview();
  const request = review.capacityRequest;
  if (!request) return null;
  const oldestId = oldestMasteryHistoryId(request.entries);
  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-capacity-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          review.cancelCapacityDeletion();
        }
      }}
    >
      <section
        className={`${styles.reorderDialog} ${styles.historyCapacityDialog}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            review.cancelCapacityDeletion();
          }
        }}
      >
        <header>
          <div>
            <h2 id="history-capacity-title">选择一份历史删除</h2>
            <span>已有五份记录。删除一份后才能保存今天的最终状态。</span>
          </div>
        </header>
        <div className={styles.capacityChoices}>
          {request.entries.map((entry) => (
            <label key={entry.id}>
              <input
                type="radio"
                name="history-capacity-deletion"
                checked={request.selectedId === entry.id}
                onChange={() => review.selectCapacityDeletion(entry.id)}
                autoFocus={request.selectedId === entry.id}
              />
              <span>
                <strong>{entry.name}</strong>
                <small>
                  {entry.localDate}
                  {entry.id === oldestId ? " · 最早记录" : ""}
                </small>
              </span>
            </label>
          ))}
        </div>
        <p className={styles.capacityWarning}>
          取消会放弃刚才触发此对话框的掌握修改。磁盘恢复快照不会受影响。
        </p>
        <footer>
          <button
            type="button"
            className={controls.secondaryAction}
            onClick={review.cancelCapacityDeletion}
          >
            取消
          </button>
          <button
            type="button"
            className={`${controls.primaryAction} ${styles.capacityConfirm}`}
            onClick={review.confirmCapacityDeletion}
          >
            删除所选并继续
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReorderDialog() {
  const questions = useQuestions();
  const ui = useWorkspaceUi();
  const item = ui.reorderDialogItem;
  if (!item) return null;
  const chapterItemCount = questions.orderedItems.filter(
    (candidate) => candidate.chapterId === item.chapterId
  ).length;
  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reorder-dialog-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) ui.closeReorderDialog(); }}
    >
      <form
        className={styles.reorderDialog}
        noValidate
        onSubmit={ui.submitReorder}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            ui.closeReorderDialog();
          }
        }}
      >
        <header>
          <h2 id="reorder-dialog-title">更改题序</h2>
          <span>当前章内第 {questions.numberById.get(item.id)} 题 / 共 {chapterItemCount} 题</span>
        </header>
        <label>
          <span>目标题序</span>
          <input
            ref={ui.reorderInputRef}
            value={ui.reorderTarget}
            inputMode="numeric"
            onChange={(event) => { ui.setReorderTarget(event.target.value); ui.setReorderError(""); }}
          />
        </label>
        {ui.reorderError && <p className={styles.reorderError}>{ui.reorderError}</p>}
        <footer>
          <button type="button" className={controls.secondaryAction} onClick={ui.closeReorderDialog}>取消</button>
          <button type="submit" className={controls.primaryAction}>确认</button>
        </footer>
      </form>
    </div>
  );
}
