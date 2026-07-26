import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useLifecycle } from "../context/questionBankContexts.js";

/**
 * 关闭窗口/退出前的保存边界,分两步:
 *
 * 1. 提交当前聚焦元素上的草稿。「原编号」「章节名称」「复习选项名/颜色」「掌握历史名称」
 *    和半截标签都只在失焦时才写进题库,用户打完字直接 Cmd+Q 时它们还只是组件本地
 *    state —— flushPendingChanges 完全看不见,会静默丢掉。
 * 2. flush 自动保存队列。
 *
 * 草稿校验失败(原编号冲突、名称重复)时抛出:preload 会把 reject 转成
 * `{ ok: false, error }`,主进程据此弹出「尚未保存」对话框,而不是安静地关掉窗口。
 */
export function useBeforeCloseFlush() {
  const lifecycle = useLifecycle();
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;

  useEffect(() => {
    return window.lqb?.onBeforeClose?.(async () => {
      const {
        beginDraftCommit,
        takeDraftCommitRejection,
        flushPendingChanges
      } = lifecycleRef.current;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) {
        beginDraftCommit();
        // 必须 flushSync:blur 处理器里的 setState 要在返回前应用完毕,
        // 之后 flushPendingChanges 才闭包到含这次编辑的 bank
        // (useLatestCallback 在 render 阶段更新 ref)。用 setTimeout 猜时机
        // 会在慢机器上退化成同一个丢数据的 bug。
        flushSync(() => active.blur());
        const rejection = takeDraftCommitRejection();
        if (rejection) throw new Error(rejection);
      }
      await flushPendingChanges();
    });
  }, []);
}
