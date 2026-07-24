import { BookOpenText, FilePlus2, FolderInput } from "lucide-react";
import { useLifecycle, useWorkspace } from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./SetupScreen.module.css";

export function SetupScreen() {
  const lifecycle = useLifecycle();
  const workspace = useWorkspace();
  return (
    <main className={styles.setupShell}>
      <section className={styles.setupPanel}>
        <div className={styles.setupCopy}>
          <div className={styles.setupBrand}>
            <img src="/brand/icon-64.png" width="44" height="44" alt="" />
            <span>LaTeX 题库</span>
          </div>
          <h1>建立你的第一个题库</h1>
          <p>选择一个普通文件夹保存题目、图片和导出文件。内容只留在你的电脑上。</p>
        </div>
        <div className={styles.setupActions}>
          <button className={controls.primaryAction} onClick={() => void workspace.createNewWorkspace()} disabled={workspace.isChangingWorkspace}>
            <FilePlus2 size={18} />新建空白题库
          </button>
          <button className={controls.secondaryAction} onClick={() => void workspace.openWorkspace()} disabled={workspace.isChangingWorkspace}>
            <FolderInput size={18} />打开已有题库
          </button>
          <button className={controls.tertiaryAction} onClick={() => void workspace.createSampleWorkspace()} disabled={workspace.isChangingWorkspace}>
            <BookOpenText size={18} />体验示例题库
          </button>
        </div>
        {lifecycle.notice && <p className={`${styles.setupNotice} ${styles[lifecycle.notice.type]}`}>{lifecycle.notice.text}</p>}
      </section>
    </main>
  );
}
