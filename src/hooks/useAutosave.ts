import { useCallback, useEffect, useRef, useState } from "react";
import { saveBank } from "../api/client.js";
import type { Bank, BankSnapshot } from "../../shared/types.js";
import type { Notice, SaveState } from "./controllerTypes.js";

export function useAutosave(bank: Bank | null, setNotice: (notice: Notice | null) => void) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const skipNextSave = useRef(true);
  const timerRef = useRef<number | null>(null);
  const workspacePathRef = useRef("");
  const revisionRef = useRef("");
  const pendingBankRef = useRef<Bank | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const inFlightBankRef = useRef<Bank | null>(null);
  const lastSavedBankRef = useRef<Bank | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const drainQueue = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const operation = (async () => {
      while (pendingBankRef.current) {
        const nextBank = pendingBankRef.current;
        pendingBankRef.current = null;
        inFlightBankRef.current = nextBank;
        setSaveState("saving");
        try {
          const snapshot = await saveBank({
            workspacePath: workspacePathRef.current,
            baseRevision: revisionRef.current,
            bank: nextBank
          });
          revisionRef.current = snapshot.revision;
          lastSavedBankRef.current = nextBank;
          setSaveState("saved");
        } catch (error) {
          if (!pendingBankRef.current) pendingBankRef.current = nextBank;
          setSaveState("error");
          setNotice({
            type: "error",
            text: error instanceof Error ? error.message : "保存题库失败。"
          });
          throw error;
        } finally {
          inFlightBankRef.current = null;
        }
      }
    })();

    inFlightRef.current = operation.finally(() => {
      inFlightRef.current = null;
    });
    return inFlightRef.current;
  }, [setNotice]);

  const flush = useCallback(
    async (nextBank?: Bank) => {
      clearTimer();
      if (
        nextBank &&
        nextBank !== lastSavedBankRef.current &&
        nextBank !== inFlightBankRef.current &&
        nextBank !== pendingBankRef.current
      ) {
        pendingBankRef.current = nextBank;
      }
      if (!pendingBankRef.current && !inFlightRef.current) return;
      await drainQueue();
    },
    [clearTimer, drainQueue]
  );

  const resetAutosave = useCallback(
    (snapshot: BankSnapshot | null) => {
      clearTimer();
      pendingBankRef.current = null;
      inFlightBankRef.current = null;
      lastSavedBankRef.current = snapshot?.bank ?? null;
      workspacePathRef.current = snapshot?.workspacePath ?? "";
      revisionRef.current = snapshot?.revision ?? "";
      skipNextSave.current = true;
      setSaveState(snapshot ? "saved" : "idle");
    },
    [clearTimer]
  );

  useEffect(() => {
    if (!bank || !workspacePathRef.current) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    clearTimer();
    setSaveState("saving");
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pendingBankRef.current = bank;
      void drainQueue().catch(() => undefined);
    }, 500);

    return clearTimer;
  }, [bank, clearTimer, drainQueue]);

  const retrySave = useCallback(async () => {
    await flush();
  }, [flush]);

  return {
    saveState,
    persistBank: flush,
    flush,
    resetAutosave,
    retrySave
  };
}
