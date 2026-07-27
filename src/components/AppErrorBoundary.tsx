import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import controls from "../styles/controls.module.css";
import styles from "./SetupScreen.module.css";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

/**
 * 渲染期异常的最后一道防线。题库只存在于内存中,没有边界时任何一次抛出都会卸载
 * 整棵树并静默丢掉尚未保存的编辑;这里把失败变成可见、可重载的状态。
 *
 * 必须包在 QuestionBankProvider 外面:updateBank 的 updater 在 Provider 自身的
 * render 阶段执行,边界放在 Provider 内部捕不到。
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error))
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("界面渲染失败。", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className={styles.setupShell}>
        <section className={`${styles.setupPanel} ${styles.recoveryPanel}`}>
          <div className={styles.setupCopy}>
            <span>界面出现异常</span>
            <h1>已停止渲染以避免继续出错</h1>
            <p>{error.message}</p>
          </div>
          <div className={styles.setupActions}>
            <button
              className={controls.primaryAction}
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={18} />重新加载
            </button>
          </div>
          <p className={styles.setupNotice}>
            磁盘上的 bank.json 没有被这次异常改动。重新加载会从磁盘重读题库；
            最后一次自动保存之后的编辑可能已丢失，可在读取失败界面选择 .history 快照恢复。
          </p>
        </section>
      </main>
    );
  }
}
