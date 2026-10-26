import type {
  ReviewPriority,
  ReviewStatus,
  SolutionSource
} from "./types.js";

export const REVIEW_PRIORITY_LABELS: Record<ReviewPriority, string> = {
  skip: "不用看",
  recheck: "再看看",
  must: "必须看"
};

export const REVIEW_PRIORITY_ORDER: ReviewPriority[] = [
  "must",
  "recheck",
  "skip"
];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "待审阅",
  approved: "已审阅"
};

export const SOLUTION_SOURCE_LABELS: Record<SolutionSource, string> = {
  "answer-book": "答案册",
  agent: "AI 生成",
  user: "用户解答",
  none: "暂无答案"
};

export const RESERVED_TAGS = new Set(["待审阅"]);

export function isReviewPriority(value: unknown): value is ReviewPriority {
  return value === "skip" || value === "recheck" || value === "must";
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === "pending" || value === "approved";
}

export function isSolutionSource(value: unknown): value is SolutionSource {
  return (
    value === "answer-book" ||
    value === "agent" ||
    value === "user" ||
    value === "none"
  );
}

export function isReservedTag(value: string): boolean {
  return RESERVED_TAGS.has(value.trim().normalize("NFKC"));
}
