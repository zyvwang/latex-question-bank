import { normalizeUniqueName } from "./names.js";
import { isReservedTag } from "./review-fields.js";
import {
  hasControlCharacter,
  invalid,
  isRecord,
  ValidationError,
  type ValidationResult
} from "./validation-primitives.js";

// 一份清单要么逐题改（changes），要么全库改（renames/deletions），不能混用；
// 全库操作对每个标签同时生效，不是依次执行。
export interface AgentTagItemChange {
  id: string;
  add?: string[];
  remove?: string[];
}

export interface AgentTagRename {
  from: string;
  to: string;
}

export interface AgentTagManifest {
  schemaVersion: 1;
  note?: string;
  changes?: AgentTagItemChange[];
  renames?: AgentTagRename[];
  deletions?: string[];
}

export interface AgentTagChangePreview {
  id: string;
  source: string;
  before: string[];
  after: string[];
}

export interface AgentTagWarning {
  code: "TAG_NOT_FOUND";
  message: string;
}

export interface AgentTagCounts {
  changed: number;
  unchanged: number;
  added: number;
  removed: number;
}

export interface AgentTagJournalEntry {
  id: string;
  before: string[];
  after: string[];
}

// 撤销记录由服务端生成、CLI 保存；撤销时只恢复标签仍等于 after 的题。
export interface AgentTagJournal {
  schemaVersion: 1;
  workspacePath: string;
  createdAt: string;
  note: string | null;
  entries: AgentTagJournalEntry[];
}

export interface AgentTagSummary {
  dryRun: boolean;
  revision: string;
  counts: AgentTagCounts;
  changes: AgentTagChangePreview[];
  warnings: AgentTagWarning[];
  journal?: AgentTagJournal;
}

export interface AgentTagUndoConflict {
  id: string;
  source: string;
  reason: "changed" | "missing";
}

export interface AgentTagUndoSummary {
  dryRun: boolean;
  revision: string;
  counts: { restored: number; unchanged: number; conflicts: number };
  restored: AgentTagChangePreview[];
  conflicts: AgentTagUndoConflict[];
}

// 单次最多改动的题数。全库改名也受此限制，保证生成的撤销记录一定能再提交。
export const MAX_TAG_ENTRIES = 5000;
const MAX_TAG_GLOBAL_OPERATIONS = 200;
const MAX_NOTE_LENGTH = 200;
const RESERVED_TAG_MESSAGE = "「待审阅」是保留标签，请使用审阅状态。";

export function tagKey(tag: string): string {
  return normalizeUniqueName(tag);
}

export function validateAgentTagManifest(
  value: unknown
): ValidationResult<AgentTagManifest> {
  return runValidation(() => parseManifest(value));
}

export function validateAgentTagJournal(
  value: unknown
): ValidationResult<AgentTagJournal> {
  return runValidation(() => parseJournal(value));
}

function runValidation<T>(parse: () => T): ValidationResult<T> {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    if (error instanceof ValidationError) return invalid(error.message);
    throw error;
  }
}

function parseManifest(value: unknown): AgentTagManifest {
  if (!isRecord(value)) throw new ValidationError("标签清单必须是对象。");
  assertKnownKeys(value, ["schemaVersion", "note", "changes", "renames", "deletions"], "标签清单");
  if (value.schemaVersion !== 1) {
    throw new ValidationError("标签清单 schemaVersion 必须为 1。");
  }
  const note = parseNote(value.note);
  const changes = parseChanges(value.changes);
  const renames = parseRenames(value.renames);
  const deletions = parseDeletions(value.deletions);
  const global = renames.length > 0 || deletions.length > 0;
  if (changes.length > 0 && global) {
    throw new ValidationError(
      "changes 不能与 renames/deletions 同时出现，请分成两份清单。"
    );
  }
  if (changes.length === 0 && !global) {
    throw new ValidationError("标签清单必须包含 changes，或 renames/deletions。");
  }
  assertGlobalOperationsConsistent(renames, deletions);
  return {
    schemaVersion: 1,
    ...(note ? { note } : {}),
    ...(changes.length ? { changes } : {}),
    ...(renames.length ? { renames } : {}),
    ...(deletions.length ? { deletions } : {})
  };
}

function parseNote(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError("note 必须是字符串。");
  }
  const note = value.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`note 最多 ${MAX_NOTE_LENGTH} 个字符。`);
  }
  return note || undefined;
}

function parseChanges(value: unknown): AgentTagItemChange[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("changes 必须是数组。");
  if (value.length > MAX_TAG_ENTRIES) {
    throw new ValidationError(`单次最多修改 ${MAX_TAG_ENTRIES} 道题的标签。`);
  }
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const label = `changes[${index}]`;
    if (!isRecord(entry)) throw new ValidationError(`${label} 必须是对象。`);
    assertKnownKeys(entry, ["id", "add", "remove"], label);
    const id = parseNonEmptyString(entry.id, `${label}.id`);
    if (ids.has(id)) {
      throw new ValidationError(`changes 中题目 ID 重复：${id}`);
    }
    ids.add(id);
    const add = parseTagList(entry.add, `${label}.add`, true);
    const remove = parseTagList(entry.remove, `${label}.remove`, false);
    if (add.length === 0 && remove.length === 0) {
      throw new ValidationError(`${label} 至少需要一个 add 或 remove 标签。`);
    }
    const removeKeys = new Set(remove.map(tagKey));
    const clash = add.find((tag) => removeKeys.has(tagKey(tag)));
    if (clash) {
      throw new ValidationError(`${label} 不能同时添加和移除「${clash}」。`);
    }
    return {
      id,
      ...(add.length ? { add } : {}),
      ...(remove.length ? { remove } : {})
    };
  });
}

function parseRenames(value: unknown): AgentTagRename[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("renames 必须是数组。");
  if (value.length > MAX_TAG_GLOBAL_OPERATIONS) {
    throw new ValidationError(`renames 最多 ${MAX_TAG_GLOBAL_OPERATIONS} 项。`);
  }
  const fromKeys = new Set<string>();
  return value.map((entry, index) => {
    const label = `renames[${index}]`;
    if (!isRecord(entry)) throw new ValidationError(`${label} 必须是对象。`);
    assertKnownKeys(entry, ["from", "to"], label);
    const from = parseTag(entry.from, `${label}.from`, false);
    const to = parseTag(entry.to, `${label}.to`, true);
    if (tagKey(from) === tagKey(to)) {
      throw new ValidationError(`${label} 的 from 与 to 相同：${from}`);
    }
    if (fromKeys.has(tagKey(from))) {
      throw new ValidationError(`renames 中来源标签重复：${from}`);
    }
    fromKeys.add(tagKey(from));
    return { from, to };
  });
}

function parseDeletions(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("deletions 必须是数组。");
  if (value.length > MAX_TAG_GLOBAL_OPERATIONS) {
    throw new ValidationError(`deletions 最多 ${MAX_TAG_GLOBAL_OPERATIONS} 项。`);
  }
  return parseTagList(value, "deletions", false);
}

function assertGlobalOperationsConsistent(
  renames: AgentTagRename[],
  deletions: string[]
): void {
  const fromKeys = new Set(renames.map((rename) => tagKey(rename.from)));
  const toKeys = new Set(renames.map((rename) => tagKey(rename.to)));
  // 链式改名（A→B、B→C）和互换会让人误以为是依次执行，直接拒绝。
  for (const rename of renames) {
    if (fromKeys.has(tagKey(rename.to))) {
      throw new ValidationError(
        `不支持链式改名：「${rename.to}」既是目标又是来源，请拆成两份清单。`
      );
    }
  }
  for (const tag of deletions) {
    const key = tagKey(tag);
    if (fromKeys.has(key) || toKeys.has(key)) {
      throw new ValidationError(`「${tag}」不能同时被改名和删除。`);
    }
  }
}

function parseJournal(value: unknown): AgentTagJournal {
  if (!isRecord(value)) throw new ValidationError("撤销记录必须是对象。");
  assertKnownKeys(
    value,
    ["schemaVersion", "workspacePath", "createdAt", "note", "entries"],
    "撤销记录"
  );
  if (value.schemaVersion !== 1) {
    throw new ValidationError("撤销记录 schemaVersion 必须为 1。");
  }
  const workspacePath = parseNonEmptyString(value.workspacePath, "workspacePath");
  const createdAt = parseNonEmptyString(value.createdAt, "createdAt");
  if (
    value.note !== undefined &&
    value.note !== null &&
    typeof value.note !== "string"
  ) {
    throw new ValidationError("note 必须是字符串或 null。");
  }
  const note = value.note ?? null;
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    throw new ValidationError("撤销记录没有条目。");
  }
  if (value.entries.length > MAX_TAG_ENTRIES) {
    throw new ValidationError(`撤销记录最多 ${MAX_TAG_ENTRIES} 条。`);
  }
  const ids = new Set<string>();
  const entries = value.entries.map((entry, index) => {
    const label = `entries[${index}]`;
    if (!isRecord(entry)) throw new ValidationError(`${label} 必须是对象。`);
    assertKnownKeys(entry, ["id", "before", "after"], label);
    const id = parseNonEmptyString(entry.id, `${label}.id`);
    if (ids.has(id)) throw new ValidationError(`撤销记录中题目 ID 重复：${id}`);
    ids.add(id);
    return {
      id,
      before: parseStoredTags(entry.before, `${label}.before`),
      after: parseStoredTags(entry.after, `${label}.after`)
    };
  });
  return { schemaVersion: 1, workspacePath, createdAt, note, entries };
}

// 撤销记录里的标签就是题库里已有的标签，只校验类型和保留标签，
// 不能比题库自身的校验更严，否则带特殊字符的旧标签永远无法撤销。
function parseStoredTags(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) {
    throw new ValidationError(`${label} 必须是字符串数组。`);
  }
  if (value.some((tag) => isReservedTag(tag))) {
    throw new ValidationError(RESERVED_TAG_MESSAGE);
  }
  return [...value];
}

// create 为 true 时（add、改名目标）标签会写入题库，按 mergeTags 的规则规范化并拒绝控制字符；
// 否则只是用来匹配题库里已有的标签，比较时用 tagKey 忽略大小写和全半角。
function parseTag(value: unknown, label: string, create: boolean): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} 必须是字符串。`);
  }
  const tag = create ? value.trim().normalize("NFKC") : value.trim();
  if (!tag) throw new ValidationError(`${label} 不能为空。`);
  if (isReservedTag(tag)) throw new ValidationError(RESERVED_TAG_MESSAGE);
  if (create && hasControlCharacter(tag)) {
    throw new ValidationError(`${label} 含有无效字符。`);
  }
  return tag;
}

function parseTagList(value: unknown, label: string, create: boolean): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${label} 必须是数组。`);
  const seen = new Set<string>();
  const tags: string[] = [];
  value.forEach((entry, index) => {
    const tag = parseTag(entry, `${label}[${index}]`, create);
    const key = tagKey(tag);
    if (seen.has(key)) return;
    seen.add(key);
    tags.push(tag);
  });
  return tags;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} 必须是非空字符串。`);
  }
  return value.trim();
}

// 清单很小，拼错字段名（如 removes）如果被静默忽略，改动会悄悄少一半，所以未知字段直接拒绝。
function assertKnownKeys(
  record: Record<string, unknown>,
  known: string[],
  label: string
): void {
  const unknown = Object.keys(record).filter((key) => !known.includes(key));
  if (unknown.length) {
    throw new ValidationError(`${label} 含有未知字段：${unknown.join("、")}。`);
  }
}
