import { Download, FileCheck2 } from "lucide-react";
import type { ExportOrderMode } from "../../shared/types.js";
import {
  useCompileExport,
  useQuestions,
  useSelection
} from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./WorkspaceView.module.css";

export function WorkspaceExportDock() {
  const questions = useQuestions();
  const selection = useSelection();
  const compileExport = useCompileExport();
  return (
    <footer className={styles.exportDock}>
      <div className={styles.compileBlock}>
        <button
          className={controls.secondaryAction}
          onClick={() => void compileExport.compileCurrentItem()}
          disabled={!questions.activeItem || compileExport.isCompiling}
        >
          <FileCheck2 size={17} />
          {compileExport.isCompiling ? "编译中" : "检查当前题"}
        </button>
        {compileExport.compileResult && !compileExport.compileResult.ok && (
          <pre className={styles.logBox}>{compileExport.compileResult.log}</pre>
        )}
        {compileExport.exportFailureResult && (
          <pre className={styles.logBox}>{compileExport.exportFailureResult.log}</pre>
        )}
      </div>
      <div className={styles.exportBlock}>
        <label className={styles.exportNameField}>
          <span>导出名</span>
          <input
            value={compileExport.exportName}
            placeholder="载入中"
            onChange={(event) => compileExport.setExportName(event.target.value)}
          />
        </label>
        <label className={styles.exportOrderField}>
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
          <label className={styles.exportSeedField}>
            <span>种子</span>
            <input
              value={compileExport.randomSeed}
              onChange={(event) => compileExport.setRandomSeed(event.target.value)}
              placeholder="留空则使用导出名"
            />
          </label>
        )}
        <button
          className={controls.primaryAction}
          onClick={() => void compileExport.exportSelected()}
          disabled={selection.selectedIds.size === 0 || compileExport.isExporting}
        >
          <Download size={17} />
          {compileExport.isExporting ? "导出中" : `导出 ${selection.selectedIds.size} 题`}
        </button>
      </div>
    </footer>
  );
}
