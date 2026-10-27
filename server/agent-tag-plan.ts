// Agent 标签整理的纯规划逻辑：不读写磁盘，只根据当前 bank 和清单算出新 bank、预览与撤销记录。
// 落盘、加锁和广播在 agent-tag-service.ts。
import {
  MAX_TAG_ENTRIES,
  tagKey,
  type AgentTagChangePreview,
  type AgentTagCounts,
  type AgentTagItemChange,
  type AgentTagJournal,
  type AgentTagManifest,
  type AgentTagUndoConflict,
  type AgentTagWarning
} from "../shared/agent-tags.js";
import { mergeTags } from "../shared/names.js";
import { questionSourceDisplay } from "../shared/question-source.js";
import type { Bank, QuestionItem } from "../shared/types.js";
import { ValidationError } from "../shared/validation-primitives.js";

export interface TagPlanInput {
  current: Bank;
  manifest: AgentTagManifest;
  now: string;
}

export interface TagPlanResult {
  bank: Bank;
  changes: AgentTagChangePreview[];
  counts: AgentTagCounts;
  warnings: AgentTagWarning[];
}

export interface TagRestoreInput {
  current: Bank;
  journal: AgentTagJournal;
  now: string;
}

export interface TagRestoreResult {
  bank: Bank;
  restored: AgentTagChangePreview[];
  unchanged: number;
  conflicts: AgentTagUndoConflict[];
}

export function planTagChanges(input: TagPlanInput): TagPlanResult {
  const { current, manifest, now } = input;
  const itemsById = new Map(current.items.map((item) => [item.id, item]));
  const nextTags = new Map<string, string[]>();
  const warnings: AgentTagWarning[] = [];
  let addressed = 0;

  if (manifest.changes) {
    for (const change of manifest.changes) {
      const item = itemsById.get(change.id);
      if (!item) {
        throw new ValidationError(`要修改标签的题目不存在：${change.id}`);
      }
      nextTags.set(item.id, applyItemChange(item.tags, change));
      addressed += 1;
    }
  } else {
    const operations = buildGlobalOperations(manifest);
    for (const item of current.items) {
      if (item.tags.some((tag) => operations.affects(tag))) {
        nextTags.set(item.id, operations.apply(item.tags));
      }
    }
    warnings.push(...missingTagWarnings(current.items, operations.selectors));
  }

  const changes: AgentTagChangePreview[] = [];
  const items = current.items.map((item) => {
    const after = nextTags.get(item.id);
    if (!after || sameTags(item.tags, after)) return item;
    changes.push({
      id: item.id,
      source: questionSourceDisplay(item, current.books),
      before: [...item.tags],
      after: [...after]
    });
    return { ...item, tags: after, updatedAt: now };
  });
  if (changes.length > MAX_TAG_ENTRIES) {
    throw new ValidationError(
      `单次最多修改 ${MAX_TAG_ENTRIES} 道题的标签，本次会修改 ${changes.length} 道。`
    );
  }

  return {
    bank: { ...current, items },
    changes,
    counts: {
      changed: changes.length,
      unchanged: manifest.changes ? addressed - changes.length : 0,
      ...countTagDelta(changes)
    },
    warnings
  };
}

export function buildTagJournal(options: {
  workspacePath: string;
  note: string | undefined;
  now: string;
  changes: AgentTagChangePreview[];
}): AgentTagJournal {
  return {
    schemaVersion: 1,
    workspacePath: options.workspacePath,
    createdAt: options.now,
    note: options.note ?? null,
    entries: options.changes.map(({ id, before, after }) => ({
      id,
      before: [...before],
      after: [...after]
    }))
  };
}

// 只恢复标签仍等于 after 的题：之后被人改过的题保持现状，已经是原状的题也不动，
// 所以同一份撤销记录可以重复执行。
export function planTagRestore(input: TagRestoreInput): TagRestoreResult {
  const { current, journal, now } = input;
  const itemsById = new Map(current.items.map((item) => [item.id, item]));
  const restoredTags = new Map<string, string[]>();
  const conflicts: AgentTagUndoConflict[] = [];
  let unchanged = 0;

  for (const entry of journal.entries) {
    const item = itemsById.get(entry.id);
    if (!item) {
      conflicts.push({ id: entry.id, source: entry.id, reason: "missing" });
    } else if (sameTags(item.tags, entry.before)) {
      unchanged += 1;
    } else if (sameTags(item.tags, entry.after)) {
      restoredTags.set(item.id, [...entry.before]);
    } else {
      conflicts.push({
        id: item.id,
        source: questionSourceDisplay(item, current.books),
        reason: "changed"
      });
    }
  }

  const restored: AgentTagChangePreview[] = [];
  const items = current.items.map((item) => {
    const tags = restoredTags.get(item.id);
    if (!tags) return item;
    restored.push({
      id: item.id,
      source: questionSourceDisplay(item, current.books),
      before: [...item.tags],
      after: [...tags]
    });
    return { ...item, tags, updatedAt: now };
  });
  return { bank: { ...current, items }, restored, unchanged, conflicts };
}

function applyItemChange(tags: string[], change: AgentTagItemChange): string[] {
  const removeKeys = new Set((change.remove ?? []).map(tagKey));
  const kept = tags.filter((tag) => !removeKeys.has(tagKey(tag)));
  return mergeTags(kept, change.add ?? []);
}

interface GlobalOperations {
  selectors: string[];
  affects: (tag: string) => boolean;
  apply: (tags: string[]) => string[];
}

// 每个标签只会被映射一次，所以改名是同时生效的，不存在先后顺序；
// 改名后撞上同一题已有的标签时合并成一个。
function buildGlobalOperations(manifest: AgentTagManifest): GlobalOperations {
  const renameByKey = new Map(
    (manifest.renames ?? []).map((rename) => [tagKey(rename.from), rename.to])
  );
  const deleteKeys = new Set((manifest.deletions ?? []).map(tagKey));
  const affects = (tag: string) => {
    const key = tagKey(tag);
    return renameByKey.has(key) || deleteKeys.has(key);
  };
  return {
    selectors: [
      ...(manifest.renames ?? []).map((rename) => rename.from),
      ...(manifest.deletions ?? [])
    ],
    affects,
    apply(tags) {
      const result: string[] = [];
      const seen = new Set<string>();
      for (const tag of tags) {
        const key = tagKey(tag);
        if (deleteKeys.has(key)) continue;
        const next = renameByKey.get(key) ?? tag;
        const nextKey = tagKey(next);
        if (seen.has(nextKey)) continue;
        seen.add(nextKey);
        result.push(next);
      }
      return result;
    }
  };
}

// 改名或删除一个没有任何题在用的标签，多半是拼错了，提醒而不是报错。
function missingTagWarnings(
  items: QuestionItem[],
  selectors: string[]
): AgentTagWarning[] {
  const used = new Set(items.flatMap((item) => item.tags.map(tagKey)));
  return selectors
    .filter((tag) => !used.has(tagKey(tag)))
    .map((tag) => ({
      code: "TAG_NOT_FOUND" as const,
      message: `没有题目使用标签「${tag}」。`
    }));
}

function countTagDelta(
  changes: AgentTagChangePreview[]
): Pick<AgentTagCounts, "added" | "removed"> {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    const before = new Set(change.before.map(tagKey));
    const after = new Set(change.after.map(tagKey));
    for (const key of after) if (!before.has(key)) added += 1;
    for (const key of before) if (!after.has(key)) removed += 1;
  }
  return { added, removed };
}

function sameTags(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((tag, index) => tag === right[index])
  );
}
