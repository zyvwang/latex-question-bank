import { useLifecycle, useQuestions } from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./SettingsScreen.module.css";

const STATUS_LABELS = {
  completed: "完成",
  partial: "部分完成",
  undone: "已撤销"
} as const;

export function ImportLogSettings() {
  const questions = useQuestions();
  const lifecycle = useLifecycle();
  const imports = [...(questions.bank?.imports ?? [])].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );

  async function copyBatch(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      lifecycle.setNotice({ type: "ok", text: "批次 ID 已复制。" });
    } catch {
      lifecycle.setNotice({ type: "error", text: "无法复制批次 ID。" });
    }
  }

  return (
    <section
      className={styles.section}
      aria-labelledby="import-log-settings-title"
    >
      <header>
        <div>
          <h2 id="import-log-settings-title">Agent 导入记录</h2>
          <p>
            只读记录。需要撤销时，让 Agent 执行
            <code> lqb import undo &lt;批次 ID&gt;</code>。
          </p>
        </div>
      </header>
      {imports.length === 0 ? (
        <p className={styles.emptyState}>
          尚无 Agent 导入记录。导入成功后会在这里留下批次信息。
        </p>
      ) : (
        <div className={styles.rows}>
          {imports.map((batch) => (
            <div className={`${styles.row} ${styles.importRow}`} key={batch.id}>
              <span className={styles.importTime}>
                {formatTimestamp(batch.createdAt)}
              </span>
              <strong className={styles.importBooks}>
                {batch.bookTitles.length
                  ? batch.bookTitles.join("、")
                  : "未登记书目"}
              </strong>
              <span className={styles.importCounts}>
                新增 {batch.newCount} · 更新 {batch.updatedCount} · 跳过{" "}
                {batch.skippedCount} · 冲突 {batch.conflictCount}
              </span>
              <span className={styles.importStatus}>
                {STATUS_LABELS[batch.status]}
              </span>
              <button
                className={controls.secondaryAction}
                onClick={() => void copyBatch(batch.id)}
                title={batch.id}
              >
                复制批次 ID
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
