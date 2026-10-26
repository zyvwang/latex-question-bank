import { AlertTriangle } from "lucide-react";
import { useLifecycle } from "../context/questionBankContexts.js";
import controls from "../styles/controls.module.css";
import styles from "./ExternalBankBanner.module.css";

export function ExternalBankBanner() {
  const lifecycle = useLifecycle();
  const notice = lifecycle.externalBankNotice;
  if (!notice) return null;
  const created = notice.counts?.created ?? 0;
  const updated = notice.counts?.updated ?? 0;
  const changeText = created
    ? `Agent 导入了 ${created} 道题。`
    : updated
      ? `Agent 更新了 ${updated} 道题。`
      : "检测到新的导入内容。";
  return (
    <div className={styles.banner} role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className={styles.text}>
        <strong>题库已在外部更新</strong>
        <span>
          {changeText}当前有未保存的编辑，重新加载会丢弃它们。
        </span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={controls.secondaryAction}
          onClick={() => {
            void lifecycle.reloadExternalBank().catch((error) => {
              lifecycle.setNotice({
                type: "error",
                text:
                  error instanceof Error
                    ? error.message
                    : "加载外部题库更新失败。"
              });
            });
          }}
        >
          重新加载
        </button>
        <button
          type="button"
          className={controls.tertiaryAction}
          onClick={lifecycle.dismissExternalBankNotice}
        >
          稍后
        </button>
      </div>
    </div>
  );
}
