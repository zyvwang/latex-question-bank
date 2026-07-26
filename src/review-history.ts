import {
  MAX_MASTERY_HISTORY_ENTRIES,
  normalizeReviewOptionOrder,
  normalizeUniqueName
} from "../shared/review-options.js";
import type {
  Bank,
  MasteryHistoryEntry,
  MasteryHistoryItemState,
  QuestionItem,
  ReviewOption
} from "../shared/types.js";

export interface ReviewHistoryMutationOptions {
  workspaceName: string;
  now: Date;
  createId: () => string;
  deleteHistoryId?: string;
}

/**
 * 这些变更由 React 事件处理器驱动,结果最终会喂给 setBank。抛异常会在 render
 * 阶段炸开并卸载整棵树,所以校验失败一律以 Result 返回,由调用方转成 notice。
 */
export type ReviewMutationResult =
  | { ok: true; bank: Bank }
  | { ok: false; error: string };

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultMasteryHistoryName(
  workspaceName: string,
  date: Date
): string {
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const name = workspaceName.trim().normalize("NFKC") || "题库";
  const day = String(date.getDate()).padStart(2, "0");
  return `${name} · ${date.getFullYear()}-${monthNames[date.getMonth()]}-${day}`;
}

export function needsHistoryCapacityDecision(bank: Bank, now: Date): boolean {
  const today = localDateKey(now);
  return (
    bank.masteryHistory.length >= MAX_MASTERY_HISTORY_ENTRIES &&
    !bank.masteryHistory.some((entry) => entry.localDate === today)
  );
}

export function oldestMasteryHistoryId(
  entries: MasteryHistoryEntry[]
): string | null {
  return [...entries].sort(compareHistoryOldestFirst)[0]?.id ?? null;
}

export function recordReviewMutation(
  bank: Bank,
  mutate: (current: Bank) => Bank,
  options: ReviewHistoryMutationOptions
): ReviewMutationResult {
  const needsCapacity = needsHistoryCapacityDecision(bank, options.now);
  const mutated = mutate(bank);
  let base = mutated;
  if (needsCapacity) {
    if (
      !options.deleteHistoryId ||
      !bank.masteryHistory.some((entry) => entry.id === options.deleteHistoryId)
    ) {
      return { ok: false, error: "创建今日掌握历史前必须选择一份历史删除。" };
    }
    base = deleteMasteryHistory(mutated, options.deleteHistoryId);
  }
  return captureDailyMasteryHistory(
    base,
    options.workspaceName,
    options.now,
    options.createId
  );
}

/**
 * 只比较进快照的两个字段。不能退化成 `previous === item` 的引用比较:
 * useBankSettingsActions 的 deleteReviewOption 会 map 全部 items 换掉每个引用,
 * 但其中绝大多数题目的复习状态并没有变。
 */
function reviewStateDiffers(
  previous: MasteryHistoryItemState,
  item: QuestionItem
): boolean {
  if (previous.masteryOptionId !== item.masteryOptionId) return true;
  if (previous.errorReasonOptionIds.length !== item.errorReasonOptionIds.length) {
    return true;
  }
  return previous.errorReasonOptionIds.some(
    (optionId, index) => optionId !== item.errorReasonOptionIds[index]
  );
}

function itemStateOf(item: QuestionItem): MasteryHistoryItemState {
  return {
    masteryOptionId: item.masteryOptionId,
    errorReasonOptionIds: [...item.errorReasonOptionIds]
  };
}

export function renameMasteryHistory(
  bank: Bank,
  id: string,
  name: string,
  now: Date
): ReviewMutationResult {
  const normalized = normalizeUniqueName(name);
  if (!normalized) return { ok: false, error: "历史名称不能为空。" };
  if (
    bank.masteryHistory.some(
      (entry) =>
        entry.id !== id && normalizeUniqueName(entry.name) === normalized
    )
  ) {
    return { ok: false, error: "历史名称已存在。" };
  }
  const nextName = name.trim().normalize("NFKC");
  const updatedAt = now.toISOString();
  return {
    ok: true,
    bank: {
      ...bank,
      masteryHistory: bank.masteryHistory.map((entry) =>
        entry.id === id ? { ...entry, name: nextName, updatedAt } : entry
      )
    }
  };
}

export function deleteMasteryHistory(bank: Bank, id: string): Bank {
  return {
    ...bank,
    masteryHistory: bank.masteryHistory.filter((entry) => entry.id !== id)
  };
}

export function restoreMasteryHistoryState(
  bank: Bank,
  id: string,
  now: Date
): ReviewMutationResult {
  const entry = bank.masteryHistory.find((candidate) => candidate.id === id);
  if (!entry) return { ok: false, error: "掌握历史不存在。" };
  const mastery = mergeHistoricalOptions(
    bank.masteryOptions,
    entry.masteryOptions
  );
  const errors = mergeHistoricalOptions(
    bank.errorReasonOptions,
    entry.errorReasonOptions
  );
  const updatedAt = now.toISOString();
  return {
    ok: true,
    bank: {
      ...bank,
      masteryOptions: mastery.options,
      errorReasonOptions: errors.options,
      items: bank.items.map((item) => {
        const state = entry.itemStates[item.id];
        if (!state) return item;
        return {
          ...item,
          masteryOptionId:
            state.masteryOptionId === null
              ? null
              : (mastery.idMap.get(state.masteryOptionId) ?? null),
          errorReasonOptionIds: unique(
            state.errorReasonOptionIds
              .map((optionId) => errors.idMap.get(optionId))
              .filter((optionId): optionId is string => Boolean(optionId))
          ),
          updatedAt
        };
      })
    }
  };
}

export function sortMasteryHistoryNewestFirst(
  entries: MasteryHistoryEntry[]
): MasteryHistoryEntry[] {
  return [...entries].sort((left, right) => compareHistoryOldestFirst(right, left));
}

function captureDailyMasteryHistory(
  bank: Bank,
  workspaceName: string,
  now: Date,
  createId: () => string
): ReviewMutationResult {
  const localDate = localDateKey(now);
  const timestamp = now.toISOString();
  const existing = bank.masteryHistory.find(
    (entry) => entry.localDate === localDate
  );
  if (existing) {
    return {
      ok: true,
      bank: {
        ...bank,
        masteryHistory: bank.masteryHistory.map((entry) =>
          entry.id === existing.id
            ? {
                ...entry,
                masteryOptions: cloneOptions(bank.masteryOptions),
                errorReasonOptions: cloneOptions(bank.errorReasonOptions),
                itemStates: patchItemStates(existing.itemStates, bank.items),
                updatedAt: timestamp
              }
            : entry
        )
      }
    };
  }
  if (bank.masteryHistory.length >= MAX_MASTERY_HISTORY_ENTRIES) {
    return { ok: false, error: "掌握历史最多保留五份。" };
  }
  const baseName = defaultMasteryHistoryName(workspaceName, now);
  // 每天首次复习才走这条全量路径,一天一次的 O(N) 可以接受。
  const entry: MasteryHistoryEntry = {
    id: createId(),
    localDate,
    name: uniqueHistoryName(baseName, bank.masteryHistory),
    createdAt: timestamp,
    updatedAt: timestamp,
    masteryOptions: cloneOptions(bank.masteryOptions),
    errorReasonOptions: cloneOptions(bank.errorReasonOptions),
    itemStates: Object.fromEntries(
      bank.items.map((item) => [item.id, itemStateOf(item)])
    )
  };
  return {
    ok: true,
    bank: { ...bank, masteryHistory: [...bank.masteryHistory, entry] }
  };
}

/**
 * 当天条目每次复习变更都要刷新,但整天下来只有零星几道题真的换了状态。全量重建
 * 会给 1000 题的库每次点击分配 ~2N 个对象(N 个 state + N 个 id 数组),所以这里
 * 只为真正变化的题新建对象,其余按引用复用。
 *
 * 键集合取自当前 items,会话中途增删题目也能自然对上。
 */
function patchItemStates(
  previous: MasteryHistoryEntry["itemStates"],
  items: QuestionItem[]
): MasteryHistoryEntry["itemStates"] {
  const itemStates: MasteryHistoryEntry["itemStates"] = {};
  for (const item of items) {
    const previousState = previous[item.id];
    itemStates[item.id] =
      previousState && !reviewStateDiffers(previousState, item)
        ? previousState
        : itemStateOf(item);
  }
  return itemStates;
}

function uniqueHistoryName(
  baseName: string,
  entries: MasteryHistoryEntry[]
): string {
  const names = new Set(entries.map((entry) => normalizeUniqueName(entry.name)));
  if (!names.has(normalizeUniqueName(baseName))) return baseName;
  let suffix = 2;
  while (names.has(normalizeUniqueName(`${baseName} (${suffix})`))) {
    suffix += 1;
  }
  return `${baseName} (${suffix})`;
}

function mergeHistoricalOptions(
  current: ReviewOption[],
  historical: ReviewOption[]
): { options: ReviewOption[]; idMap: Map<string, string> } {
  const options = normalizeReviewOptionOrder(current).map((option) => ({
    ...option
  }));
  const idMap = new Map<string, string>();
  for (const historicalOption of normalizeReviewOptionOrder(historical)) {
    const byId = options.find((option) => option.id === historicalOption.id);
    if (byId) {
      idMap.set(historicalOption.id, byId.id);
      continue;
    }
    const normalizedName = normalizeUniqueName(historicalOption.name);
    const byName = options.find(
      (option) => normalizeUniqueName(option.name) === normalizedName
    );
    if (byName) {
      idMap.set(historicalOption.id, byName.id);
      continue;
    }
    options.push({
      ...historicalOption,
      order: options.length + 1
    });
    idMap.set(historicalOption.id, historicalOption.id);
  }
  return {
    options: normalizeReviewOptionOrder(options),
    idMap
  };
}

function cloneOptions(options: ReviewOption[]): ReviewOption[] {
  return options.map((option) => ({ ...option }));
}

function compareHistoryOldestFirst(
  left: MasteryHistoryEntry,
  right: MasteryHistoryEntry
): number {
  return (
    left.localDate.localeCompare(right.localDate) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
