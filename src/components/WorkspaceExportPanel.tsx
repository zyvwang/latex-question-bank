import { useEffect, useState } from "react";
import { Download, FileCheck2 } from "lucide-react";
import type { ExportOrderMode } from "../../shared/types.js";
import {
  useCompileExport,
  useQuestions,
  useSelection
} from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./WorkspaceView.module.css";

export function WorkspaceExportPanel({ exportEnabled }: { exportEnabled: boolean }) {
  const questions = useQuestions();
  const selection = useSelection();
  const compileExport = useCompileExport();
  const [open, setOpen] = useState(false);
  const pendingSelected =
    questions.bank?.items.filter(
      (item) =>
        selection.selectedIds.has(item.id) && item.reviewStatus === "pending"
    ).length ?? 0;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className={styles.editorActions}>
      <button
        className={controls.secondaryAction}
        onClick={() => void compileExport.compileCurrentItem()}
        disabled={!questions.activeItem || compileExport.isCompiling}
      >
        <FileCheck2 size={16} />
        {compileExport.isCompiling ? "编译中" : "检查当前题"}
      </button>
      {exportEnabled && (
        <button
          className={controls.primaryAction}
          aria-expanded={open}
          aria-controls="export-panel"
          onClick={() => setOpen(!open)}
        >
          导出
        </button>
      )}
      {open && exportEnabled && (
        <section className={styles.exportPanel} id="export-panel" aria-label="导出设置">
          <h2>导出已选的 {selection.selectedIds.size} 题</h2>
          <p>生成题目版和完整版的 PDF 与 TeX 文件。</p>
          <label className={styles.exportField}>
            <span>导出名</span>
            <input
              value={compileExport.exportName}
              placeholder="载入中"
              onChange={(event) => compileExport.setExportName(event.target.value)}
            />
          </label>
          <label className={styles.exportField}>
            <span>顺序</span>
            <select
              value={compileExport.exportOrderMode}
              onChange={(event) => compileExport.setExportOrderMode(event.target.value as ExportOrderMode)}
            >
              <option value="normal">正常顺序</option>
              <option value="random">随机顺序</option>
            </select>
          </label>
          {compileExport.exportOrderMode === "random" && (
            <label className={styles.exportField}>
              <span>种子</span>
              <input
                value={compileExport.randomSeed}
                onChange={(event) => compileExport.setRandomSeed(event.target.value)}
                placeholder="留空则使用导出名"
              />
            </label>
          )}
          {pendingSelected > 0 && (
            <p className={styles.pendingExportWarning}>{`其中 ${pendingSelected} 道待审阅`}</p>
          )}
          <button
            className={controls.primaryAction}
            onClick={() => void compileExport.exportSelected()}
            disabled={selection.selectedIds.size === 0 || compileExport.isExporting}
          >
            <Download size={16} />
            {compileExport.isExporting ? "导出中" : `导出 ${selection.selectedIds.size} 题`}
          </button>
          {compileExport.exportFailureResult && (
            <pre className={styles.logBox}>{compileExport.exportFailureResult.log}</pre>
          )}
        </section>
      )}
      {compileExport.compileResult && !compileExport.compileResult.ok && (
        <pre className={`${styles.logBox} ${styles.compileLog}`}>{compileExport.compileResult.log}</pre>
      )}
    </div>
  );
}
