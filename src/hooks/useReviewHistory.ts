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
    now: Date,
    options: { protectedHistoryId?: string } = {}
  ): boolean => {
    if (!bank) return false;
    if (capacityRequest) {
      setNotice({ type: "info", text: "请先完成掌握历史容量选择。" });
      return false;
    }
    if (needsHistoryCapacityDecision(bank, now)) {
      // 恢复某份历史时不能把它列为删除候选:确认后会先恢复再删,刚恢复的那份就没了。
      const entries = bank.masteryHistory.filter(
        (entry) => entry.id !== options.protectedHistoryId
      );
      const selectedId = oldestMasteryHistoryId(entries);
      if (!selectedId) {
        setNotice({ type: "error", text: "没有可删除的掌握历史。" });
        return false;
      }
      setCapacityRequest({ entries, selectedId, updater });
      return false;
    }
    // 在事件回调里算完再交给 setBank:updater 里抛错会在 render 阶段炸开。
    const result = recordReviewMutation(bank, updater, {
      workspaceName,
      now,
      createId: () => crypto.randomUUID()
    });
    if (!result.ok) {
      setNotice({ type: "error", text: result.error });
      return false;
    }
    updateBank(() => result.bank);
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
    if (!bank || !capacityRequest) return;
    const request = capacityRequest;
    const result = recordReviewMutation(bank, request.updater, {
      workspaceName,
      now: new Date(),
      createId: () => crypto.randomUUID(),
      deleteHistoryId: request.selectedId
    });
    if (!result.ok) {
      // 保留对话框,让用户改选一份仍然存在的历史。
      setNotice({ type: "error", text: result.error });
      return;
    }
    setCapacityRequest(null);
    updateBank(() => result.bank);
    setNotice({
      type: "ok",
      text: "已删除所选历史，并保存本次掌握修改。"
    });
  }, [bank, capacityRequest, setNotice, updateBank, workspaceName]);

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
    const result = renameMasteryHistory(bank, id, name, new Date());
    if (!result.ok) {
      setNotice({ type: "error", text: result.error });
      return false;
    }
    updateBank(() => result.bank);
    setNotice({ type: "ok", text: "掌握历史名称已更新。" });
    return true;
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
    const now = new Date();
    const restored = restoreMasteryHistoryState(bank, id, now);
    if (!restored.ok) {
      setNotice({ type: "error", text: restored.error });
      return;
    }
    // updater 必须基于 current 重算,不能闭包住这里的 restored.bank:历史满五份时
    // applyReviewMutationAt 会把它存进 capacityRequest 延后到用户确认才执行,
    // 交回一份快照期的 bank 会连带丢掉这期间的所有编辑。
    applyReviewMutationAt(
      (current) => {
        const result = restoreMasteryHistoryState(current, id, now);
        return result.ok ? result.bank : current;
      },
      now,
      { protectedHistoryId: id }
    );
  }, [applyReviewMutationAt, bank, setNotice]);

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
