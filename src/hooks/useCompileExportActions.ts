import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compileItem,
  exportItems,
  fetchDefaultExportName,
  uploadQuestionAsset
} from "../api/client.js";
import type {
  Bank,
  CompileResponse,
  ExportOrderMode,
  ExportResponse,
  ModuleKind,
  QuestionItem
} from "../../shared/types.js";
import { compileContentVersion } from "../utils/compileVersion.js";
import type { Notice } from "./controllerTypes.js";

interface CompileExportOptions {
  activeItem: QuestionItem | null;
  bank: Bank | null;
  workspacePath: string;
  selectedIds: Set<string>;
  persistBank: (bank: Bank) => Promise<void>;
  setNotice: (notice: Notice | null) => void;
  updateItem: (id: string, patch: Partial<QuestionItem>) => void;
}

interface CompileTarget {
  itemId: string;
  contentVersion: string;
}

interface CompileRecord extends CompileTarget {
  result: CompileResponse;
}

export function useCompileExportActions({
  activeItem,
  bank,
  workspacePath,
  selectedIds,
  persistBank,
  setNotice,
  updateItem
}: CompileExportOptions) {
  const initialExportName = defaultExportName();
  const [exportName, setExportNameState] = useState(initialExportName);
  const [exportOrderMode, setExportOrderMode] = useState<ExportOrderMode>("normal");
  const [randomSeed, setRandomSeed] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [compileTarget, setCompileTarget] = useState<CompileTarget | null>(null);
  const [compileRecord, setCompileRecord] = useState<CompileRecord | null>(null);
  const [exportFailureResult, setExportFailureResult] = useState<CompileResponse | null>(null);
  const exportNameManualRef = useRef(false);
  const exportNameRef = useRef(initialExportName);
  const compileGenerationRef = useRef(0);

  const currentContentVersion = useMemo(
    () => activeItem && bank ? compileContentVersion(activeItem, bank.settings) : null,
    [activeItem, bank]
  );
  const compileStatus = useMemo(() => {
    if (compileTarget) {
      return matchesCurrent(compileTarget, activeItem, currentContentVersion)
        ? { state: "compiling" as const, text: "正在编译当前题。" }
        : { state: "stale" as const, text: "编译内容已变化，完成后结果将过期。" };
    }
    if (!compileRecord) return null;
    if (!matchesCurrent(compileRecord, activeItem, currentContentVersion)) {
      return { state: "stale" as const, text: "编译结果已过期，请重新检查。" };
    }
    return compileRecord.result.ok
      ? {
          state: "success" as const,
          text: "当前题编译通过。",
          pdfUrl: compileRecord.result.pdfUrl
        }
      : { state: "failure" as const, text: "当前题编译失败，查看日志摘要。" };
  }, [activeItem, compileRecord, compileTarget, currentContentVersion]);
  const compileResult =
    compileStatus?.state === "failure" && compileRecord ? compileRecord.result : null;

  useEffect(() => {
    exportNameManualRef.current = false;
    setAutomaticExportName(defaultExportName());
    if (!workspacePath) return;
    let cancelled = false;
    void fetchDefaultExportName()
      .then((name) => {
        if (!cancelled && !exportNameManualRef.current) setAutomaticExportName(name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  function setExportName(value: string) {
    exportNameManualRef.current = true;
    exportNameRef.current = value;
    setExportNameState(value);
  }

  function setAutomaticExportName(value: string) {
    exportNameRef.current = value;
    setExportNameState(value);
  }

  const resetCompileState = useCallback(() => {
    compileGenerationRef.current += 1;
    setCompileTarget(null);
    setCompileRecord(null);
    setExportFailureResult(null);
  }, []);

  async function uploadAsset(kind: ModuleKind, file: File) {
    if (!activeItem) return;
    const { patch } = await uploadQuestionAsset(kind, activeItem, file);
    updateItem(activeItem.id, patch);
    setNotice({ type: "ok", text: "图片已插入当前模块。" });
  }

  async function compileCurrentItem() {
    if (!activeItem || !bank) return;
    const item = activeItem;
    const settings = bank.settings;
    const target = {
      itemId: item.id,
      contentVersion: compileContentVersion(item, settings)
    };
    const generation = ++compileGenerationRef.current;
    setCompileRecord(null);
    setCompileTarget(target);
    try {
      const result = await compileItem(item, settings);
      if (compileGenerationRef.current !== generation) return;
      setCompileRecord({ ...target, result });
    } catch (error) {
      if (compileGenerationRef.current !== generation) return;
      setNotice({ type: "error", text: error instanceof Error ? error.message : "当前题编译失败。" });
    } finally {
      if (compileGenerationRef.current === generation) setCompileTarget(null);
    }
  }

  async function exportSelected() {
    if (!bank) return;
    if (selectedIds.size === 0) {
      setNotice({ type: "error", text: "请至少勾选一道题目。" });
      return;
    }
    setIsExporting(true);
    setExportFailureResult(null);
    setNotice({ type: "info", text: "正在导出四份文件。" });
    let automaticName = !exportNameManualRef.current;
    try {
      let requestedName = exportNameRef.current;
      if (automaticName) {
        const freshName = await fetchDefaultExportName();
        if (exportNameManualRef.current) {
          automaticName = false;
          requestedName = exportNameRef.current;
        } else {
          requestedName = freshName;
          setAutomaticExportName(freshName);
        }
      }
      await persistBank(bank);
      const effectiveRandomSeed =
        exportOrderMode === "random" ? randomSeed.trim() || requestedName : undefined;
      const data = (await exportItems({
        itemIds: [...selectedIds],
        fileName: requestedName,
        orderMode: exportOrderMode,
        randomSeed: effectiveRandomSeed
      })) as ExportResponse & { error?: string };
      if (!data.ok) {
        const failedResult = data.results?.questions.ok ? data.results.full : data.results?.questions;
        setNotice({
          type: "error",
          text: data.error ?? "导出失败，查看编译日志摘要。",
          action: failedResult?.texUrl
            ? { type: "open-url", href: failedResult.texUrl }
            : undefined
        });
        setExportFailureResult(failedResult ?? null);
        return;
      }
      setNotice({
        type: "ok",
        text: `导出完成：${data.files.join("、")}`,
        action: {
          type: "reveal-export",
          exportName: data.exportName,
          label: "打开文件位置"
        }
      });
      if (automaticName && !exportNameManualRef.current) {
        const nextName = await fetchDefaultExportName()
          .catch(() => incrementAutomaticExportName(requestedName));
        setAutomaticExportName(nextName);
      }
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "导出失败。" });
    } finally {
      setIsExporting(false);
    }
  }

  return {
    exportName,
    exportOrderMode,
    randomSeed,
    isExporting,
    isCompiling: Boolean(compileTarget),
    compileResult,
    exportFailureResult,
    compileStatus,
    setExportName,
    setExportOrderMode,
    setRandomSeed,
    resetCompileState,
    uploadAsset,
    compileCurrentItem,
    exportSelected
  };
}

function defaultExportName(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `questions-${year}-${month}-${day}-1`;
}

function incrementAutomaticExportName(exportName: string): string {
  const match = /^(questions-\d{4}-\d{2}-\d{2})-([1-9]\d*)$/.exec(exportName);
  if (!match) return exportName;
  return `${match[1]}-${Number(match[2]) + 1}`;
}

function matchesCurrent(
  target: CompileTarget,
  activeItem: QuestionItem | null,
  currentContentVersion: string | null
): boolean {
  return Boolean(
    activeItem &&
    target.itemId === activeItem.id &&
    target.contentVersion === currentContentVersion
  );
}
