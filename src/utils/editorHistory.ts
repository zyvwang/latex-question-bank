import type { ModuleKind } from "../../shared/types.js";

/**
 * 编辑器撤销历史的边界：同一个 key 内的编辑共享撤销历史，key 一变就重建编辑器。
 * 包含整库快照代次、题目和模块，避免 ⌘Z 把别的题、别的模块或整库替换前的文本
 * 撤销进当前模块并被自动保存。文本相同（包括都是空串）也照样隔离。
 */
export function editorHistoryKey(snapshotEpoch: number, itemId: string, kind: ModuleKind) {
  return `${snapshotEpoch}:${itemId}:${kind}`;
}
