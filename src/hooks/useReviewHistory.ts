import { useCallback, useEffect, useState } from "react";
import type { Bank, MasteryHistoryEntry } from "../../shared/types.js";
import {
  deleteMasteryHistory,
  needsHistoryCapacityDecision,
  oldestMasteryHistoryId,
  recordReviewMutation,
  renameMasteryHistory,
  restoreMasteryHistoryState
} from "../review-history.js";
import type { Notice } from "./controllerTypes.js";

interface ReviewHistoryOptions {
  bank: Bank | null;
  workspaceName: string;
  workspaceKey: string;
  updateBank: (updater: (current: Bank) => Bank) => void;
  setNotice: (notice: Notice | null) => void;
}

interface CapacityRequest {
  entries: MasteryHistoryEntry[];
  selectedId: string;
  updater: (current: Bank) => Bank;
}

export function useReviewHistory({
  bank,
  workspaceName,
  workspaceKey,
  updateBank,
  setNotice
}: ReviewHistoryOptions) {
  const [capacityRequest, setCapacityRequest] =
    useState<CapacityRequest | null>(null);

  useEffect(() => {
    setCapacityRequest(null);
  }, [workspaceKey]);

  const applyReviewMutationAt = useCallback((
    updater: (current: Bank) => Bank,
    now: Date
  ): boolean => {
    if (!bank) return false;
    if (capacityRequest) {
      setNotice({ type: "info", text: "请先完成掌握历史容量选择。" });
      return false;
    }
    if (needsHistoryCapacityDecision(bank, now)) {
      const selectedId = oldestMasteryHistoryId(bank.masteryHistory);
      if (!selectedId) return false;
      setCapacityRequest({
        entries: bank.masteryHistory,
        selectedId,
        updater
      });
      return false;
    }
    updateBank((current) =>
      recordReviewMutation(current, updater, {
        workspaceName,
        now,
        createId: () => crypto.randomUUID()
      })
    );
    return true;
  }, [
    bank,
    capacityRequest,
    setNotice,
    updateBank,
    workspaceName
  ]);

  const applyReviewMutation = useCallback((
    updater: (current: Bank) => Bank
  ): boolean => applyReviewMutationAt(updater, new Date()), [
    applyReviewMutationAt
  ]);

  const selectCapacityDeletion = useCallback((id: string) => {
    setCapacityRequest((current) =>
      current &&
      current.entries.some((entry) => entry.id === id)
        ? { ...current, selectedId: id }
        : current
    );
  }, []);

  const confirmCapacityDeletion = useCallback(() => {
    if (!capacityRequest) return;
    const request = capacityRequest;
    setCapacityRequest(null);
    const now = new Date();
    updateBank((current) =>
      recordReviewMutation(current, request.updater, {
        workspaceName,
        now,
        createId: () => crypto.randomUUID(),
        deleteHistoryId: request.selectedId
      })
    );
    setNotice({
      type: "ok",
      text: "已删除所选历史，并保存本次掌握修改。"
    });
  }, [capacityRequest, setNotice, updateBank, workspaceName]);

  const cancelCapacityDeletion = useCallback(() => {
    if (!capacityRequest) return;
    setCapacityRequest(null);
    setNotice({ type: "info", text: "已取消，本次掌握修改未应用。" });
  }, [capacityRequest, setNotice]);
  const resetHistoryUi = useCallback(() => {
    setCapacityRequest(null);
  }, []);

  const renameHistory = useCallback((id: string, name: string): boolean => {
    if (!bank) return false;
    const now = new Date();
    try {
      renameMasteryHistory(bank, id, name, now);
      updateBank((current) => renameMasteryHistory(current, id, name, now));
      setNotice({ type: "ok", text: "掌握历史名称已更新。" });
      return true;
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "历史名称无效。"
      });
      return false;
    }
  }, [bank, setNotice, updateBank]);

  const deleteHistory = useCallback((id: string) => {
    if (!bank) return;
    const entry = bank.masteryHistory.find((candidate) => candidate.id === id);
    if (!entry) return;
    if (
      !window.confirm(
        `确定删除掌握历史“${entry.name}”吗？\n\n此操作不会删除磁盘恢复快照。`
      )
    ) {
      return;
    }
    updateBank((current) => deleteMasteryHistory(current, id));
    setNotice({ type: "ok", text: "掌握历史已删除。" });
  }, [bank, setNotice, updateBank]);

  const restoreHistory = useCallback((id: string) => {
    if (!bank) return;
    const entry = bank.masteryHistory.find((candidate) => candidate.id === id);
    if (!entry) return;
    if (
      !window.confirm(
        `确定恢复“${entry.name}”吗？\n\n只恢复掌握程度、错误原因及缺失的选项定义。题目正文、章节、题序和素材保持不变。`
      )
    ) {
      return;
    }
    applyReviewMutationAt(
      (current) => restoreMasteryHistoryState(current, id, new Date()),
      new Date()
    );
  }, [applyReviewMutationAt, bank]);

  return {
    masteryHistory: bank?.masteryHistory ?? [],
    capacityRequest: capacityRequest
      ? {
          entries: capacityRequest.entries,
          selectedId: capacityRequest.selectedId
        }
      : null,
    applyReviewMutation,
    selectCapacityDeletion,
    confirmCapacityDeletion,
    cancelCapacityDeletion,
    resetHistoryUi,
    renameHistory,
    deleteHistory,
    restoreHistory
  };
}
