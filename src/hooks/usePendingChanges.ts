import { useCallback, useRef, useState } from "react";
import type { Notice } from "./controllerTypes.js";

interface PendingChangesBoundary {
  waitForSaveAs: () => Promise<void>;
  hasPendingUploads: () => boolean;
  isWorkspaceChanging: () => boolean;
  flushCurrentChanges: () => Promise<void>;
}

export function usePendingChanges() {
  const [notice, setNoticeState] = useState<Notice | null>(null);
  // 只读取 beginDraftCommit 与同步 blur 之间的校验错误，避免历史提示阻止退出。
  const draftRejectionRef = useRef<string | null>(null);
  const setNotice = useCallback((next: Notice | null) => {
    if (next?.type === "error") draftRejectionRef.current = next.text;
    setNoticeState(next);
  }, []);
  const beginDraftCommit = useCallback(() => { draftRejectionRef.current = null; }, []);
  const takeDraftCommitRejection = useCallback(() => {
    const rejection = draftRejectionRef.current;
    draftRejectionRef.current = null;
    return rejection;
  }, []);
  const flushPendingChanges = useCallback(async (boundary: PendingChangesBoundary) => {
    await boundary.waitForSaveAs();
    if (boundary.hasPendingUploads()) {
      throw new Error("图片仍在上传，请等待上传完成后重试关闭。");
    }
    if (boundary.isWorkspaceChanging()) {
      throw new Error("正在切换工作区，请完成后重试关闭。");
    }
    await boundary.flushCurrentChanges();
  }, []);
  return { notice, setNotice, beginDraftCommit, takeDraftCommitRejection, flushPendingChanges };
}
