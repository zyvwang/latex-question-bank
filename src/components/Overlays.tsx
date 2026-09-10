import {
  Copy,
  HardDriveDownload,
  ListOrdered,
  Plus,
  RefreshCw,
  Save,
  Trash2
} from "lucide-react";
import { useMemo } from "react";
import {
  useLifecycle,
  useQuestions,
  useReview,
  useWorkspace,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { oldestMasteryHistoryId } from "../review-history.js";
import { summarizeBankConflict } from "../save-conflict.js";
import controls from "../styles/controls.module.css";
import styles from "./Overlays.module.css";

export function Overlays() {
  const questions = useQuestions();
  const lifecycle = useLifecycle();
  const review = useReview();
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
      {/* 条件渲染而非组件内早返回:focus trap 要在对话框内容挂载时才生效。 */}
      {review.capacityRequest && <HistoryCapacityDialog />}
      {lifecycle.saveIssue?.kind === "conflict" &&
        lifecycle.isConflictDialogOpen && <SaveConflictDialog />}
    </>
  );
}

function SaveConflictDialog() {
  const lifecycle = useLifecycle();
  const questions = useQuestions();
  const workspace = useWorkspace();
  const dialogRef = useFocusTrap<HTMLElement>();
  const issue =
    lifecycle.saveIssue?.kind === "conflict"
      ? lifecycle.saveIssue
      : null;
  const summary = useMemo(() => {
    if (!questions.bank || !issue?.diskSnapshot) return null;
    return summarizeBankConflict(
      questions.bank,
      issue.diskSnapshot.bank
    );
  }, [issue?.diskSnapshot, questions.bank]);
  if (!issue) return null;

  const changedSections = summary
    ? [
        summary.settingsChanged && "LaTeX 设置",
        summary.chaptersChanged && "章节",
        summary.masteryOptionsChanged && "掌握程度选项",
        summary.errorReasonOptionsChanged && "错误原因选项",
        summary.masteryHistoryChanged && "掌握历史"
      ].filter((label): label is string => Boolean(label))
    : [];

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-conflict-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          lifecycle.closeConflictDialog();
        }
      }}
    >
      <section
        ref={dialogRef}
        className={`${styles.reorderDialog} ${styles.conflictDialog}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            lifecycle.closeConflictDialog();
          }
        }}
      >
        <header>
          <div>
            <h2 id="save-conflict-title">题库保存冲突</h2>
            <span>
              磁盘文件在编辑期间发生了变化。自动保存已经暂停，继续编辑只会更新内存草稿。
            </span>
          </div>
        </header>

        {issue.diskSnapshot && summary ? (
          <div className={styles.conflictSummary}>
            <strong>当前本地版本与磁盘版本</strong>
            <dl>
              <div>
                <dt>仅本地题目</dt>
                <dd>{summary.localOnlyItems}</dd>
              </div>
              <div>
                <dt>仅磁盘题目</dt>
                <dd>{summary.diskOnlyItems}</dd>
              </div>
              <div>
                <dt>同题内容不同</dt>
                <dd>{summary.changedItems}</dd>
              </div>
            </dl>
            <p>
              {changedSections.length > 0
                ? `其他差异：${changedSections.join("、")}`
                : "其他设置与记录没有差异。"}
            </p>
          </div>
        ) : issue.diskReadError ? (
          <p className={styles.conflictReadError}>
            无法读取磁盘版本：{issue.diskReadError}
          </p>
        ) : (
          <p className={styles.conflictLoading}>正在读取磁盘版本…</p>
        )}

        <div className={styles.conflictActions}>
          <button
            type="button"
            disabled={lifecycle.isSavingConflictAs}
            className={controls.secondaryAction}
            onClick={() => void lifecycle.refreshSaveConflict()}
          >
            <RefreshCw size={16} />
            刷新差异
          </button>
          <button
            type="button"
            disabled={lifecycle.isSavingConflictAs}
            className={controls.secondaryAction}
            onClick={workspace.openCurrentWorkspaceFolder}
          >
            <HardDriveDownload size={16} />
            打开工作区
          </button>
          <button
            type="button"
            disabled={lifecycle.isSavingConflictAs}
            className={controls.secondaryAction}
            onClick={() => void lifecycle.saveConflictAs()}
          >
            <Copy size={16} />
            另存为新题库
          </button>
          <button
            type="button"
            className={`${controls.secondaryAction} ${styles.conflictDiscard}`}
            disabled={lifecycle.isSavingConflictAs || !issue.diskSnapshot}
            onClick={() => void lifecycle.useDiskVersion()}
          >
            <HardDriveDownload size={16} />
            采用磁盘版本
          </button>
          <button
            type="button"
            disabled={lifecycle.isSavingConflictAs}
            className={controls.primaryAction}
            onClick={() => void lifecycle.overwriteDiskVersion()}
          >
            <Save size={16} />
            用本地版本覆盖
          </button>
        </div>
        <footer>
          {lifecycle.isSaveAsUncertain && <button className={controls.secondaryAction}
            onClick={() => void lifecycle.saveConflictAs()}>核对另存结果</button>}
          <span role="status">{lifecycle.isSaveAsUncertain ? "另存结果尚未确认，草稿已保留。" : lifecycle.isSavingConflictAs ? "正在另存，请稍候…" : "关闭后可继续编辑，自动保存仍保持暂停。"}</span>
          <button
            type="button"
            disabled={lifecycle.isSavingConflictAs}
            className={controls.tertiaryAction}
            onClick={lifecycle.closeConflictDialog}
          >
            暂时关闭
          </button>
        </footer>
      </section>
    </div>
  );
}

function HistoryCapacityDialog() {
  const review = useReview();
  const dialogRef = useFocusTrap<HTMLElement>();
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
        ref={dialogRef}
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
                data-autofocus={request.selectedId === entry.id ? "" : undefined}
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
  const dialogRef = useFocusTrap<HTMLFormElement>();
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
        ref={dialogRef}
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
