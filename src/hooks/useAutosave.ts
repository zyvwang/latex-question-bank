import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  fetchBank,
  saveBank
} from "../api/client.js";
import type { Bank, BankSnapshot } from "../../shared/types.js";
import type { Notice, SaveIssue, SaveState } from "./controllerTypes.js";

export interface SaveSession {
  readonly workspacePath: string;
  readonly generation: number;
}

export function useAutosave(
  bank: Bank | null,
  setNotice: (notice: Notice | null) => void
) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveIssue, setSaveIssueState] = useState<SaveIssue | null>(null);
  const skipNextSave = useRef(true);
  const timerRef = useRef<number | null>(null);
  const workspacePathRef = useRef("");
  const revisionRef = useRef("");
  const pendingBankRef = useRef<Bank | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const inFlightBankRef = useRef<Bank | null>(null);
  const lastSavedBankRef = useRef<Bank | null>(null);
  const saveIssueRef = useRef<SaveIssue | null>(null);
  const generationRef = useRef(0);
  const latestBankRef = useRef(bank);
  latestBankRef.current = bank;

  const captureSaveSession = useCallback((): SaveSession => ({
    workspacePath: workspacePathRef.current,
    generation: generationRef.current
  }), []);
  const isSaveSessionCurrent = useCallback((session: SaveSession) =>
    session.workspacePath === workspacePathRef.current &&
    session.generation === generationRef.current, []);

  const setSaveIssue = useCallback((issue: SaveIssue | null) => {
    saveIssueRef.current = issue;
    setSaveIssueState(issue);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refreshConflict = useCallback(async () => {
    const issue = saveIssueRef.current;
    if (issue?.kind !== "conflict") return;
    const generation = generationRef.current;
    const workspacePath = workspacePathRef.current;
    try {
      const snapshot = await fetchBank();
      if (snapshot.workspacePath !== workspacePath) {
        throw new Error("磁盘题库已切换到其他工作区。");
      }
      if (
        generation === generationRef.current &&
        saveIssueRef.current?.kind === "conflict"
      ) {
        setSaveIssue({
          ...saveIssueRef.current,
          diskSnapshot: snapshot,
          diskReadError: null
        });
      }
    } catch (error) {
      if (
        generation === generationRef.current &&
        saveIssueRef.current?.kind === "conflict"
      ) {
        setSaveIssue({
          ...saveIssueRef.current,
          diskSnapshot: null,
          diskReadError:
            error instanceof Error ? error.message : "读取磁盘版本失败。"
        });
      }
    }
  }, [setSaveIssue]);

  const pauseAfterFailure = useCallback(
    (error: unknown, failedBank: Bank, generation: number) => {
      if (generation !== generationRef.current) return;
      if (!pendingBankRef.current) pendingBankRef.current = failedBank;
      const message =
        error instanceof Error ? error.message : "保存题库失败。";
      if (
        error instanceof ApiRequestError &&
        error.code === "BANK_CONFLICT"
      ) {
        setSaveIssue({
          kind: "conflict",
          message,
          diskSnapshot: null,
          diskReadError: null
        });
        setSaveState("conflict");
        setNotice({ type: "error", text: message });
        void refreshConflict();
        return;
      }
      setSaveIssue({
        kind: "error",
        message,
        code: error instanceof ApiRequestError ? error.code : undefined
      });
      setSaveState("error");
      setNotice({ type: "error", text: message });
    },
    [refreshConflict, setNotice, setSaveIssue]
  );

  const drainQueue = useCallback(
    (firstBaseRevision?: string): Promise<void> => {
      if (inFlightRef.current) return inFlightRef.current;
      if (saveIssueRef.current) {
        return Promise.reject(new Error(saveIssueRef.current.message));
      }

      const generation = generationRef.current;
      const workspacePath = workspacePathRef.current;
      let baseRevisionOverride = firstBaseRevision;
      const operation = (async () => {
        while (
          pendingBankRef.current &&
          generation === generationRef.current &&
          !saveIssueRef.current
        ) {
          const nextBank = pendingBankRef.current;
          pendingBankRef.current = null;
          inFlightBankRef.current = nextBank;
          setSaveState("saving");
          try {
            const snapshot = await saveBank({
              workspacePath,
              baseRevision: baseRevisionOverride ?? revisionRef.current,
              bank: nextBank
            });
            baseRevisionOverride = undefined;
            if (generation !== generationRef.current) return;
            revisionRef.current = snapshot.revision;
            lastSavedBankRef.current = nextBank;
            setSaveState("saved");
          } catch (error) {
            pauseAfterFailure(error, nextBank, generation);
            throw error;
          } finally {
            if (generation === generationRef.current) {
              inFlightBankRef.current = null;
            }
          }
        }
      })();

      const trackedOperation = operation.finally(() => {
        if (inFlightRef.current === trackedOperation) {
          inFlightRef.current = null;
        }
      });
      inFlightRef.current = trackedOperation;
      return trackedOperation;
    },
    [pauseAfterFailure]
  );

  const queueLatestBank = useCallback((nextBank?: Bank) => {
    if (
      nextBank &&
      nextBank !== lastSavedBankRef.current &&
      nextBank !== inFlightBankRef.current &&
      nextBank !== pendingBankRef.current
    ) {
      pendingBankRef.current = nextBank;
    }
  }, []);

  const flush = useCallback(
    async (nextBank?: Bank) => {
      clearTimer();
      queueLatestBank(nextBank);
      if (saveIssueRef.current) {
        throw new Error(saveIssueRef.current.message);
      }
      if (!pendingBankRef.current && !inFlightRef.current) return;
      await drainQueue();
    },
    [clearTimer, drainQueue, queueLatestBank]
  );

  const flushSession = useCallback(async (session: SaveSession): Promise<BankSnapshot> => {
    const assertSession = () => {
      if (!session.workspacePath || !isSaveSessionCurrent(session)) {
        throw new Error("工作区会话已变化，旧操作已取消。");
      }
    };
    assertSession();
    // 在身份校验后取最新编辑，不能让等待前的 bank 覆盖保存队列。
    await flush(latestBankRef.current ?? undefined);
    assertSession();
    if (!lastSavedBankRef.current) throw new Error("没有可导出的题库。");
    return {
      workspacePath: session.workspacePath,
      revision: revisionRef.current,
      bank: lastSavedBankRef.current
    };
  }, [flush, isSaveSessionCurrent]);

  const resetAutosave = useCallback(
    (snapshot: BankSnapshot | null) => {
      generationRef.current += 1;
      latestBankRef.current = snapshot?.bank ?? null;
      clearTimer();
      pendingBankRef.current = null;
      inFlightRef.current = null;
      inFlightBankRef.current = null;
      lastSavedBankRef.current = snapshot?.bank ?? null;
      workspacePathRef.current = snapshot?.workspacePath ?? "";
      revisionRef.current = snapshot?.revision ?? "";
      skipNextSave.current = true;
      setSaveIssue(null);
      setSaveState(snapshot ? "saved" : "idle");
    },
    [clearTimer, setSaveIssue]
  );

  useEffect(() => {
    if (!bank || !workspacePathRef.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    clearTimer();
    pendingBankRef.current = bank;
    if (saveIssueRef.current) return;
    setSaveState("saving");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void drainQueue().catch(() => undefined);
    }, 500);

    return clearTimer;
  }, [bank, clearTimer, drainQueue]);

  const retrySave = useCallback(async () => {
    if (saveIssueRef.current?.kind === "conflict") {
      throw new Error("请先处理题库保存冲突。");
    }
    setSaveIssue(null);
    if (!pendingBankRef.current) return;
    await drainQueue();
    setNotice({ type: "ok", text: "题库已保存。" });
  }, [drainQueue, setNotice, setSaveIssue]);

  const overwriteConflict = useCallback(
    async (nextBank: Bank, latestRevision: string) => {
      if (saveIssueRef.current?.kind !== "conflict") {
        throw new Error("当前没有待处理的保存冲突。");
      }
      clearTimer();
      pendingBankRef.current = nextBank;
      setSaveIssue(null);
      await drainQueue(latestRevision);
    },
    [clearTimer, drainQueue, setSaveIssue]
  );

  return {
    saveState,
    saveIssue,
    persistBank: flush,
    captureSaveSession,
    isSaveSessionCurrent,
    flushSession,
    flush,
    resetAutosave,
    retrySave,
    refreshConflict,
    overwriteConflict
  };
}
