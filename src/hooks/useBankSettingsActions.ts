import { useCallback } from "react";
import {
  itemsInChapter,
  orderedChapters
} from "../../shared/chapter-order.js";
import {
  hasUniqueNormalizedNames,
  isHexColor,
  normalizeReviewOptionOrder,
  normalizeUniqueName
} from "../../shared/review-options.js";
import type {
  Bank,
  Chapter,
  ReviewOption
} from "../../shared/types.js";
import type { Notice } from "./controllerTypes.js";

type ReviewKind = "mastery" | "errorReason";

interface BankSettingsActionsOptions {
  bank: Bank | null;
  updateBank: (updater: (current: Bank) => Bank) => void;
  updateReviewBank: (updater: (current: Bank) => Bank) => boolean;
  setNotice: (notice: Notice | null) => void;
}

export function useBankSettingsActions({
  bank,
  updateBank,
  updateReviewBank,
  setNotice
}: BankSettingsActionsOptions) {
  const createChapter = useCallback((name: string): string | null => {
    if (!bank) return null;
    const normalized = normalizeUniqueName(name);
    if (!normalized) {
      setNotice({ type: "error", text: "章节名称不能为空。" });
      return null;
    }
    if (bank.chapters.some((chapter) => normalizeUniqueName(chapter.name) === normalized)) {
      setNotice({ type: "error", text: "章节名称已存在。" });
      return null;
    }
    const chapter: Chapter = {
      id: crypto.randomUUID(),
      name: name.trim().normalize("NFKC"),
      order: bank.chapters.length + 1
    };
    updateBank((current) => ({
      ...current,
      chapters: [...current.chapters, chapter]
    }));
    setNotice({ type: "ok", text: `已创建章节“${chapter.name}”。` });
    return chapter.id;
  }, [bank, setNotice, updateBank]);

  const renameChapter = useCallback((id: string, name: string): boolean => {
    if (!bank) return false;
    const normalized = normalizeUniqueName(name);
    const candidate = bank.chapters.map((chapter) =>
      chapter.id === id
        ? { ...chapter, name: name.trim().normalize("NFKC") }
        : chapter
    );
    if (!normalized || !hasUniqueNormalizedNames(candidate)) {
      setNotice({
        type: "error",
        text: normalized ? "章节名称已存在。" : "章节名称不能为空。"
      });
      return false;
    }
    updateBank((current) => ({
      ...current,
      chapters: current.chapters.map((chapter) =>
        chapter.id === id
          ? { ...chapter, name: name.trim().normalize("NFKC") }
          : chapter
      )
    }));
    setNotice({ type: "ok", text: "章节名称已更新。" });
    return true;
  }, [bank, setNotice, updateBank]);

  const moveChapter = useCallback((id: string, direction: -1 | 1) => {
    if (!bank) return;
    const chapters = orderedChapters(bank.chapters);
    const index = chapters.findIndex((chapter) => chapter.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= chapters.length) return;
    [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
    updateBank((current) => ({
      ...current,
      chapters: chapters.map((chapter, chapterIndex) => ({
        ...chapter,
        order: chapterIndex + 1
      }))
    }));
  }, [bank, updateBank]);

  const moveChapterToIndex = useCallback((id: string, targetIndex: number) => {
    if (!bank) return;
    const chapters = orderedChapters(bank.chapters);
    const index = chapters.findIndex((chapter) => chapter.id === id);
    if (index < 0 || targetIndex < 0 || targetIndex >= chapters.length) return;
    const [chapter] = chapters.splice(index, 1);
    chapters.splice(targetIndex, 0, chapter);
    updateBank((current) => ({
      ...current,
      chapters: chapters.map((candidate, chapterIndex) => ({
        ...candidate,
        order: chapterIndex + 1
      }))
    }));
  }, [bank, updateBank]);

  const deleteChapter = useCallback((id: string) => {
    if (!bank) return;
    const chapter = bank.chapters.find((candidate) => candidate.id === id);
    if (!chapter) return;
    const movedItems = itemsInChapter(bank.items, id);
    if (
      movedItems.some((item, index) => {
        const source = item.sourceNumber?.trim();
        if (!source) return false;
        return (
          bank.items.some(
            (candidate) =>
              candidate.chapterId === null &&
              candidate.sourceNumber?.trim() === source
          ) ||
          movedItems
            .slice(0, index)
            .some((candidate) => candidate.sourceNumber?.trim() === source)
        );
      })
    ) {
      setNotice({
        type: "error",
        text: "删除后会在未分类题目中造成原编号冲突，请先调整冲突编号。"
      });
      return;
    }
    const suffix = movedItems.length
      ? `\n\n其中 ${movedItems.length} 道题将移入未分类。`
      : "";
    if (!window.confirm(`确定删除章节“${chapter.name}”吗？${suffix}`)) return;
    const uncategorizedCount = itemsInChapter(bank.items, null).length;
    const movedOrderById = new Map(
      movedItems.map((item, index) => [item.id, uncategorizedCount + index + 1])
    );
    const now = new Date().toISOString();
    updateBank((current) => ({
      ...current,
      chapters: orderedChapters(
        current.chapters.filter((candidate) => candidate.id !== id)
      ).map((candidate, index) => ({ ...candidate, order: index + 1 })),
      items: current.items.map((item) =>
        item.chapterId === id
          ? {
              ...item,
              chapterId: null,
              chapterOrder: movedOrderById.get(item.id) ?? item.chapterOrder,
              updatedAt: now
            }
          : item
      )
    }));
    setNotice({ type: "ok", text: "章节已删除，相关题目已移入未分类。" });
  }, [bank, setNotice, updateBank]);

  const createReviewOption = useCallback((
    kind: ReviewKind,
    option: Pick<ReviewOption, "name" | "color" | "pattern">
  ): boolean => {
    if (!bank) return false;
    const currentOptions = optionsForKind(bank, kind);
    const name = option.name.trim().normalize("NFKC");
    const color = option.color.toUpperCase();
    if (
      !name ||
      currentOptions.some(
        (candidate) =>
          normalizeUniqueName(candidate.name) === normalizeUniqueName(name)
      )
    ) {
      setNotice({ type: "error", text: "选项名称不能为空且必须唯一。" });
      return false;
    }
    if (!isHexColor(color)) {
      setNotice({ type: "error", text: "颜色必须使用 #RRGGBB 格式。" });
      return false;
    }
    const next: ReviewOption = {
      id: crypto.randomUUID(),
      name,
      color,
      pattern: option.pattern,
      order: currentOptions.length + 1
    };
    // 选项定义的增改排序不改变任何题目的复习状态,不记入当天掌握历史,
    // 也就不会在历史满五份时把用户拦在删除对话框前。
    updateBank((current) => replaceOptions(
      current,
      kind,
      [...optionsForKind(current, kind), next]
    ));
    setNotice({ type: "ok", text: `已创建选项“${name}”。` });
    return true;
  }, [bank, setNotice, updateBank]);

  const updateReviewOption = useCallback((
    kind: ReviewKind,
    id: string,
    patch: Partial<Pick<ReviewOption, "name" | "color" | "pattern">>
  ): boolean => {
    if (!bank) return false;
    const options = optionsForKind(bank, kind);
    const nextOptions = options.map((option) =>
      option.id === id
        ? {
            ...option,
            ...patch,
            name: patch.name === undefined
              ? option.name
              : patch.name.trim().normalize("NFKC"),
            color: patch.color === undefined
              ? option.color
              : patch.color.toUpperCase()
          }
        : option
    );
    const changed = nextOptions.find((option) => option.id === id);
    if (!changed || !hasUniqueNormalizedNames(nextOptions)) {
      setNotice({ type: "error", text: "选项名称不能为空且必须唯一。" });
      return false;
    }
    if (!isHexColor(changed.color)) {
      setNotice({ type: "error", text: "颜色必须使用 #RRGGBB 格式。" });
      return false;
    }
    updateBank((current) => replaceOptions(current, kind, nextOptions));
    setNotice({ type: "ok", text: "选项已更新。" });
    return true;
  }, [bank, setNotice, updateBank]);

  const moveReviewOption = useCallback((
    kind: ReviewKind,
    id: string,
    direction: -1 | 1
  ) => {
    if (!bank) return;
    const options = normalizeReviewOptionOrder(optionsForKind(bank, kind));
    const index = options.findIndex((option) => option.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= options.length) return;
    [options[index], options[target]] = [options[target], options[index]];
    updateBank((current) => replaceOptions(
      current,
      kind,
      options.map((option, optionIndex) => ({
        ...option,
        order: optionIndex + 1
      }))
    ));
  }, [bank, updateBank]);

  const moveReviewOptionToIndex = useCallback((
    kind: ReviewKind,
    id: string,
    targetIndex: number
  ) => {
    if (!bank) return;
    const options = normalizeReviewOptionOrder(optionsForKind(bank, kind));
    const index = options.findIndex((option) => option.id === id);
    if (index < 0 || targetIndex < 0 || targetIndex >= options.length) return;
    const [option] = options.splice(index, 1);
    options.splice(targetIndex, 0, option);
    updateBank((current) => replaceOptions(
      current,
      kind,
      options.map((candidate, optionIndex) => ({
        ...candidate,
        order: optionIndex + 1
      }))
    ));
  }, [bank, updateBank]);

  const deleteReviewOption = useCallback((kind: ReviewKind, id: string) => {
    if (!bank) return;
    const option = optionsForKind(bank, kind).find((candidate) => candidate.id === id);
    if (!option) return;
    const affectedCount = bank.items.filter((item) =>
      kind === "mastery"
        ? item.masteryOptionId === id
        : item.errorReasonOptionIds.includes(id)
    ).length;
    if (
      !window.confirm(
        `确定删除“${option.name}”吗？\n\n将清除 ${affectedCount} 道题中的对应引用。`
      )
    ) {
      return;
    }
    // 与增改排序不同:删除会清掉题目上的 masteryOptionId / errorReasonOptionIds,
    // 属于题目复习状态变更,必须记入当天掌握历史。
    const applied = updateReviewBank((current) => ({
      ...replaceOptions(
        current,
        kind,
        optionsForKind(current, kind).filter((candidate) => candidate.id !== id)
      ),
      items: current.items.map((item) =>
        kind === "mastery"
          ? {
              ...item,
              masteryOptionId:
                item.masteryOptionId === id ? null : item.masteryOptionId
            }
          : {
              ...item,
              errorReasonOptionIds: item.errorReasonOptionIds.filter(
                (optionId) => optionId !== id
              )
            }
      )
    }));
    if (applied) {
      setNotice({ type: "ok", text: "选项已删除，题目引用已清除。" });
    }
  }, [bank, setNotice, updateReviewBank]);

  return {
    createChapter,
    renameChapter,
    moveChapter,
    moveChapterToIndex,
    deleteChapter,
    createReviewOption,
    updateReviewOption,
    moveReviewOption,
    moveReviewOptionToIndex,
    deleteReviewOption
  };
}

function optionsForKind(bank: Bank, kind: ReviewKind): ReviewOption[] {
  return kind === "mastery" ? bank.masteryOptions : bank.errorReasonOptions;
}

function replaceOptions(
  bank: Bank,
  kind: ReviewKind,
  options: ReviewOption[]
): Bank {
  const normalized = normalizeReviewOptionOrder(options);
  return kind === "mastery"
    ? { ...bank, masteryOptions: normalized }
    : { ...bank, errorReasonOptions: normalized };
}
