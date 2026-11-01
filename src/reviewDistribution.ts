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
  name: string;
  items: QuestionItem[];
  counts: DistributionCounts;
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

/** 空章节不出现（与侧栏一致）：没有题目就没有分布可看。 */
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
  const groups: DistributionGroup[] = chapters.flatMap((chapter) => {
    const items = itemsByChapter.get(chapter.id);
    if (!items) return [];
    return [{
      id: chapter.id,
      name: chapter.name,
      items,
      counts: countByPriority(items)
    }];
  });
  const uncategorized = itemsByChapter.get(null);
  if (uncategorized) {
    groups.push({
      id: "uncategorized",
      name: "未分类",
      items: uncategorized,
      counts: countByPriority(uncategorized)
    });
  }
  return groups;
}
