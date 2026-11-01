import type { KeyboardEvent } from "react";
import { MODULE_KINDS, moduleLabels } from "../constants.js";
import {
  useCompileExport,
  useQuestions,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import type { ModuleKind } from "../../shared/types.js";
import { ModuleEditor } from "./ModuleEditor.js";
import { WorkspaceExportPanel } from "./WorkspaceExportPanel.js";
import styles from "./WorkspaceView.module.css";

export function WorkspaceEditorSurface({ exportEnabled }: { exportEnabled: boolean }) {
  const questions = useQuestions();
  const compileExport = useCompileExport();
  const ui = useWorkspaceUi();
  const item = questions.activeItem;
  if (!item) return null;

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, kind: ModuleKind) {
    const index = MODULE_KINDS.indexOf(kind);
    const nextIndex =
      event.key === "ArrowRight" ? (index + 1) % MODULE_KINDS.length :
      event.key === "ArrowLeft" ? (index - 1 + MODULE_KINDS.length) % MODULE_KINDS.length :
      event.key === "Home" ? 0 : event.key === "End" ? MODULE_KINDS.length - 1 : -1;
    if (nextIndex === -1) return;
    event.preventDefault();
    ui.setActiveModule(MODULE_KINDS[nextIndex]);
    document.getElementById(`module-tab-${MODULE_KINDS[nextIndex]}`)?.focus();
  }

  return (
    <section className={styles.editorSurface}>
      <header className={styles.editorHeader}>
        <div className={styles.moduleTabs} role="tablist" aria-label="题目模块">
          {MODULE_KINDS.map((kind) => (
            <button
              id={`module-tab-${kind}`}
              key={kind}
              role="tab"
              aria-selected={ui.activeModule === kind}
              aria-controls={`module-panel-${kind}`}
              tabIndex={ui.activeModule === kind ? 0 : -1}
              className={ui.activeModule === kind ? styles.activeTab : ""}
              onClick={() => ui.setActiveModule(kind)}
              onKeyDown={(event) => handleTabKey(event, kind)}
            >
              <span>{moduleLabels[kind]}</span>
              {!item.modules[kind].tex.trim() && <small>空</small>}
            </button>
          ))}
        </div>
        <WorkspaceExportPanel exportEnabled={exportEnabled} />
      </header>
      <ModuleEditor
        kind={ui.activeModule}
        value={item.modules[ui.activeModule].tex}
        item={item}
        onChange={(value) => questions.updateItem(item.id, {
          modules: {
            ...item.modules,
            [ui.activeModule]: { ...item.modules[ui.activeModule], tex: value }
          }
        })}
        onUpload={(file) => compileExport.uploadAsset(ui.activeModule, file)}
      />
    </section>
  );
}
