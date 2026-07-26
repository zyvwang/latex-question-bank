import type { ModuleKind } from "../shared/types.js";

export const MODULE_KINDS: ModuleKind[] = ["question", "solution", "note"];

export const moduleLabels: Record<ModuleKind, string> = {
  question: "题目",
  solution: "解析",
  note: "备注"
};
