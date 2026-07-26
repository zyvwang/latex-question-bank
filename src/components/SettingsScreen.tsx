import { AlertTriangle, FileCheck2 } from "lucide-react";
import {
  useLifecycle,
  useQuestions,
  useWorkspace
} from "../context/questionBankContexts.js";
import { ChapterSettings } from "./ChapterSettings.js";
import { MasteryHistorySettings } from "./MasteryHistorySettings.js";
import { ReviewOptionSettings } from "./ReviewOptionSettings.js";
import { WorkspaceSettings } from "./WorkspaceSettings.js";
import styles from "./SettingsScreen.module.css";

export function SettingsScreen() {
  return (
    <main className={styles.screen} id="main-workspace">
      <header className={styles.pageHeader}>
        <div>
          <span>当前工作区</span>
          <h1>题库设置</h1>
        </div>
        <p>有效变更会自动保存。名称和颜色在按 Enter 或离开输入框后提交。</p>
      </header>
      <WorkspaceSettings />
      <ChapterSettings />
      <ReviewOptionSettings kind="mastery" />
      <ReviewOptionSettings kind="errorReason" />
      <MasteryHistorySettings />
      <LatexSettings />
    </main>
  );
}

function LatexSettings() {
  const lifecycle = useLifecycle();
  const questions = useQuestions();
  const workspace = useWorkspace();
  const bank = questions.bank;
  const appInfo = workspace.appInfo;
  if (!bank || !appInfo) return null;
  return (
    <section className={styles.section} aria-labelledby="latex-settings-title">
      <header>
        <div>
          <h2 id="latex-settings-title">LaTeX</h2>
          <p>管理导出间距、全局导言区与本机 latexmk 路径。</p>
        </div>
      </header>
      <div className={styles.latexGrid}>
        <button
          type="button"
          className={`${styles.texStatus} ${
            appInfo.texStatus.available ? styles.texAvailable : styles.texMissing
          }`}
          title={appInfo.texStatus.message}
          onClick={() =>
            lifecycle.setNotice({
              type: appInfo.texStatus.available ? "ok" : "error",
              text: appInfo.texStatus.message
            })
          }
        >
          {appInfo.texStatus.available
            ? <FileCheck2 size={15} />
            : <AlertTriangle size={15} />}
          {appInfo.texStatus.available ? "TeX 可用" : "未检测到 TeX"}
        </button>
        <label>
          <span>题间距</span>
          <input
            value={bank.settings.spacing.item}
            onChange={(event) =>
              questions.updateBank((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  spacing: {
                    ...current.settings.spacing,
                    item: event.target.value
                  }
                }
              }))
            }
          />
        </label>
        <label>
          <span>模块间距</span>
          <input
            value={bank.settings.spacing.module}
            onChange={(event) =>
              questions.updateBank((current) => ({
                ...current,
                settings: {
                  ...current.settings,
                  spacing: {
                    ...current.settings.spacing,
                    module: event.target.value
                  }
                }
              }))
            }
          />
        </label>
        <label>
          <span>latexmk 路径</span>
          <input
            value={workspace.texPathDraft}
            onChange={(event) => workspace.setTexPathDraft(event.target.value)}
            onBlur={() => void workspace.saveTexPathOverride()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="留空自动检测"
          />
        </label>
        <label className={styles.preambleField}>
          <span>导言区</span>
          <textarea
            value={bank.settings.preamble}
            onChange={(event) =>
              questions.updateBank((current) => ({
                ...current,
                settings: { ...current.settings, preamble: event.target.value }
              }))
            }
            spellCheck={false}
          />
        </label>
      </div>
    </section>
  );
}
