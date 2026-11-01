import {
  REVIEW_PRIORITY_ORDER,
  UNSET_PRIORITY_LABEL,
  reviewPriorityLabel
} from "../shared/review-fields.js";
import type { Chapter, QuestionItem, ReviewPriority } from "../shared/types.js";
import { UNSET_PRIORITY_FILTER } from "./questionFilters.js";

export type DistributionStatus = ReviewPriority | "unset";

export const DISTRIBUTION_STATUSES: DistributionStatus[] = [
  ...REVIEW_PRIORITY_ORDER,
  "unset"
];

export type DistributionCounts = Record<DistributionStatus, number>;

export interface DistributionGroup {
  id: string;
  numeral: string | null;
  name: string;
  items: QuestionItem[];
  counts: DistributionCounts;
}

export type DistributionNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End";

export function distributionCellId(itemId: string): string {
  return `distribution-cell-${itemId}`;
}

export function distributionStatus(
  priority: ReviewPriority | null
): DistributionStatus {
  return priority ?? "unset";
}

export function distributionStatusLabel(status: DistributionStatus): string {
  return status === "unset" ? UNSET_PRIORITY_LABEL : reviewPriorityLabel(status);
}

export function distributionStatusFilter(status: DistributionStatus): string {
  return status === "unset" ? UNSET_PRIORITY_FILTER : status;
}

export function countByPriority(items: QuestionItem[]): DistributionCounts {
  const counts: DistributionCounts = { must: 0, recheck: 0, skip: 0, unset: 0 };
  for (const item of items) counts[distributionStatus(item.reviewPriority)] += 1;
  return counts;
}

export function percentOf(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

/** 空章节不出现（与侧栏一致）：没有题目就没有分布可看。序号仍按章节全序，不因跳过而错位。 */
export function buildDistributionGroups(
  orderedItems: QuestionItem[],
  chapters: Chapter[]
): DistributionGroup[] {
  const itemsByChapter = new Map<string | null, QuestionItem[]>();
  for (const item of orderedItems) {
    const bucket = itemsByChapter.get(item.chapterId);
    if (bucket) bucket.push(item);
    else itemsByChapter.set(item.chapterId, [item]);
  }
  const groups: DistributionGroup[] = chapters.flatMap((chapter, index) => {
    const items = itemsByChapter.get(chapter.id);
    if (!items) return [];
    return [{
      id: chapter.id,
      numeral: toChineseNumber(index + 1),
      name: chapter.name,
      items,
      counts: countByPriority(items)
    }];
  });
  const uncategorized = itemsByChapter.get(null);
  if (uncategorized) {
    groups.push({
      id: "uncategorized",
      numeral: null,
      name: "未分类",
      items: uncategorized,
      counts: countByPriority(uncategorized)
    });
  }
  return groups;
}

export function describeDistributionItem(input: {
  chapterName: string;
  chapterOrder: number;
  sourceText: string | null;
  status: DistributionStatus;
}): string {
  return [
    `章节 ${input.chapterName}`,
    `章内第 ${input.chapterOrder} 题`,
    `来源 ${input.sourceText || "未设置"}`,
    `复习优先级 ${distributionStatusLabel(input.status)}`
  ].join("，");
}

export function nextDistributionItemId(
  groups: DistributionGroup[],
  currentId: string,
  key: DistributionNavigationKey
): string {
  const groupIndex = groups.findIndex((group) =>
    group.items.some((item) => item.id === currentId)
  );
  if (groupIndex === -1) return currentId;
  const group = groups[groupIndex];
  const itemIndex = group.items.findIndex((item) => item.id === currentId);

  if (key === "Home") return group.items[0].id;
  if (key === "End") return group.items[group.items.length - 1].id;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const allItems = groups.flatMap((candidate) => candidate.items);
    const index = allItems.findIndex((item) => item.id === currentId);
    const target = key === "ArrowLeft" ? index - 1 : index + 1;
    return allItems[target]?.id ?? currentId;
  }
  const targetGroup = groups[key === "ArrowUp" ? groupIndex - 1 : groupIndex + 1];
  if (!targetGroup) return currentId;
  return targetGroup.items[Math.min(itemIndex, targetGroup.items.length - 1)].id;
}

export function isDistributionNavigationKey(
  key: string
): key is DistributionNavigationKey {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key);
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
