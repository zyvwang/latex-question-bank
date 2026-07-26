import { orderItemsByChapter, orderedChapters } from "../shared/chapter-order.js";
import type { Bank, QuestionItem } from "../shared/types.js";

export type HeatmapMode = "mastery" | "errorReason" | "combined";

export interface HeatmapGroup {
  id: string;
  chapterId: string | null;
  numeral: string | null;
  name: string;
  items: QuestionItem[];
}

export type HeatmapNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

export function buildHeatmapGroups(bank: Bank): HeatmapGroup[] {
  const orderedItems = orderItemsByChapter(bank.items, bank.chapters);
  const groups: HeatmapGroup[] = orderedChapters(bank.chapters).map((chapter, index) => ({
    id: `heatmap-group-${index}`,
    chapterId: chapter.id,
    numeral: toChineseNumber(index + 1),
    name: chapter.name,
    items: orderedItems.filter((item) => item.chapterId === chapter.id)
  }));
  groups.push({
    id: "heatmap-group-uncategorized",
    chapterId: null,
    numeral: null,
    name: "未分类",
    items: orderedItems.filter((item) => item.chapterId === null)
  });
  return groups;
}

export interface HeatmapItemDescription {
  chapterName: string;
  chapterOrder: number;
  sourceNumber?: string;
  masteryName?: string;
  errorReasonNames: string[];
}

/**
 * 只接收已解析好的字段,不再吃整个 bank:格子渲染是 1000 题量级的热路径,
 * 调用方(HeatmapGrid)已经建好 id → option 的 Map,这里不能再线性 find 一遍。
 */
export function describeHeatmapItem(input: HeatmapItemDescription): string {
  return [
    `章节 ${input.chapterName}`,
    `章内第 ${input.chapterOrder} 题`,
    `原编号 ${input.sourceNumber?.trim() || "未设置"}`,
    `掌握程度 ${input.masteryName || "未设置"}`,
    `错误原因 ${
      input.errorReasonNames.length ? input.errorReasonNames.join("、") : "未设置"
    }`
  ].join("，");
}

export function nextHeatmapItemId(
  groups: HeatmapGroup[],
  currentId: string,
  key: HeatmapNavigationKey
): string {
  const nonEmptyGroups = groups.filter((group) => group.items.length > 0);
  const groupIndex = nonEmptyGroups.findIndex((group) =>
    group.items.some((item) => item.id === currentId)
  );
  if (groupIndex === -1) return currentId;
  const group = nonEmptyGroups[groupIndex];
  const itemIndex = group.items.findIndex((item) => item.id === currentId);

  if (key === "Home") return group.items[0].id;
  if (key === "End") return group.items[group.items.length - 1].id;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const allItems = nonEmptyGroups.flatMap((candidate) => candidate.items);
    const index = allItems.findIndex((item) => item.id === currentId);
    const target = key === "ArrowLeft" ? index - 1 : index + 1;
    return allItems[Math.max(0, Math.min(allItems.length - 1, target))]?.id ?? currentId;
  }

  const targetGroupIndex =
    key === "ArrowUp" ? groupIndex - 1 : groupIndex + 1;
  const targetGroup = nonEmptyGroups[targetGroupIndex];
  if (!targetGroup) return currentId;
  return targetGroup.items[Math.min(itemIndex, targetGroup.items.length - 1)].id;
}

export function toChineseNumber(value: number): string {
  if (!Number.isInteger(value) || value <= 0 || value > 9999) {
    return String(value);
  }
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = ["", "十", "百", "千"];
  const text = String(value);
  let result = "";
  let pendingZero = false;
  for (let index = 0; index < text.length; index += 1) {
    const digit = Number(text[index]);
    const unit = units[text.length - index - 1];
    if (digit === 0) {
      if (result && /[1-9]/.test(text.slice(index + 1))) pendingZero = true;
      continue;
    }
    if (pendingZero) {
      result += "零";
      pendingZero = false;
    }
    result += `${digits[digit]}${unit}`;
  }
  return result.startsWith("一十") ? result.slice(1) : result;
}
