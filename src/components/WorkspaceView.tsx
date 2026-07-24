import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ListOrdered,
  Plus,
  Save,
  Trash2
} from "lucide-react";
import {
  useCompileExport,
  useLifecycle,
  useQuestions,
  useWorkspaceUi
} from "../context/questionBankContexts.js";
import { revealExportFolder } from "../api/client.js";
import type { NoticeAction } from "../hooks/controllerTypes.js";
import controls from "../styles/controls.module.css";
import { WorkspaceDetails } from "./WorkspaceDetails.js";
import { WorkspaceEditorSurface } from "./WorkspaceEditorSurface.js";
import { WorkspaceExportDock } from "./WorkspaceExportDock.js";
import styles from "./WorkspaceView.module.css";

export function WorkspaceView() {
  const questions = useQuestions();
  return (
    <section className={styles.workspace} id="main-workspace">
      <TopBar />
      {questions.activeItem ? <ActiveWorkspace /> : <EmptyWorkspace />}
      <WorkspaceExportDock />
    </section>
  );
}

function TopBar() {
  const compileExport = useCompileExport();
  const lifecycle = useLifecycle();
  const questions = useQuestions();

  async function runNoticeAction(action: NoticeAction) {
    try {
      if (action.type === "open-url") {
        openUrl(action.href);
      } else if (window.lqb?.revealExportFolder) {
        await window.lqb.revealExportFolder(action.exportName);
      } else {
        await revealExportFolder(action.exportName);
      }
    } catch (error) {
      lifecycle.setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "无法打开导出文件位置。"
      });
    }
  }

  return (
    <header className={styles.topBar}>
      <div className={styles.statusCluster}>
        <span className={`${styles.savePill} ${styles[lifecycle.saveState]}`}>
          {lifecycle.saveState === "saving" ? <Save size={15} /> :
            lifecycle.saveState === "error" ? <AlertTriangle size={15} /> : <Check size={15} />}
          {lifecycle.saveState === "saving" ? "保存中" :
            lifecycle.saveState === "error" ? "保存失败" : "已保存"}
        </span>
        {compileExport.compileStatus && (
          <div
            className={`${styles.notice} ${
              styles[compileStatusTone(compileExport.compileStatus.state)]
            }`}
            role="status"
          >
            {compileExport.compileStatus.state === "success"
              ? <Check size={15} />
              : <AlertTriangle size={15} />}
            <span>{compileExport.compileStatus.text}</span>
            {compileExport.compileStatus.pdfUrl && (
              <button
                type="button"
                onClick={() => openUrl(compileExport.compileStatus!.pdfUrl!)}
              >
                打开
              </button>
            )}
          </div>
        )}
        {lifecycle.notice && (
          <div className={`${styles.notice} ${styles[lifecycle.notice.type]}`} role="status">
            {lifecycle.notice.type === "error" ? <AlertTriangle size={15} /> : <Check size={15} />}
            <span>{lifecycle.notice.text}</span>
            {lifecycle.saveState === "error" && (
              <button type="button" onClick={() => void lifecycle.retrySave()}>重试保存</button>
            )}
            {questions.canUndoDelete && (
              <button type="button" onClick={questions.undoDelete}>撤销</button>
            )}
            {lifecycle.notice.action && (
              <button
                type="button"
                onClick={() => void runNoticeAction(lifecycle.notice!.action!)}
              >
                {lifecycle.notice.action.label ?? "打开"}
              </button>
            )}
          </div>
        )}
      </div>
      <div className={styles.toolbar}>
        <ToolbarButton label="上移" onClick={() => questions.moveActive(-1)}><ArrowUp size={18} /></ToolbarButton>
        <ToolbarButton label="下移" onClick={() => questions.moveActive(1)}><ArrowDown size={18} /></ToolbarButton>
        <ReorderButton />
        <ToolbarButton label="删除题目" danger onClick={questions.deleteActiveItem}><Trash2 size={18} /></ToolbarButton>
      </div>
    </header>
  );
}

function ReorderButton() {
  const questions = useQuestions();
  const ui = useWorkspaceUi();
  return (
    <ToolbarButton
      label="更改题序"
      disabled={!questions.activeItem}
      onClick={() => questions.activeItem && ui.openReorderDialog(questions.activeItem.id)}
    >
      <ListOrdered size={18} />
    </ToolbarButton>
  );
}

function ToolbarButton(props: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`${controls.iconButton} ${props.danger ? controls.danger : ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
    >
      {props.children}
    </button>
  );
}

function ActiveWorkspace() {
  return (
    <>
      <WorkspaceDetails />
      <WorkspaceEditorSurface />
    </>
  );
}

function EmptyWorkspace() {
  const questions = useQuestions();
  return (
    <section className={styles.emptyState}>
      <p>当前工作区还没有题目</p>
      <button className={controls.primaryAction} onClick={() => questions.addItem({ type: "append" })}>
        <Plus size={16} />新增题目
      </button>
    </section>
  );
}

function compileStatusTone(state: "compiling" | "success" | "failure" | "stale") {
  if (state === "success") return "ok";
  if (state === "compiling") return "info";
  return "error";
}

function openUrl(href: string) {
  const url = new URL(href, window.location.href).href;
  if (window.lqb?.openExternal) void window.lqb.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
