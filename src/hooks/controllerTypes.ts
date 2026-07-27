import type {
  BankSnapshot,
  ExportOrderMode,
  ModuleKind
} from "../../shared/types.js";
import type { DropPosition } from "../itemOrder.js";

export type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
export type SaveIssue =
  | {
      kind: "error";
      message: string;
      code?: string;
    }
  | {
      kind: "conflict";
      message: string;
      diskSnapshot: BankSnapshot | null;
      diskReadError: string | null;
    };
export type NoticeAction =
  | { type: "open-url"; href: string; label?: string }
  | { type: "reveal-export"; exportName: string; label: string };
export type Notice = {
  type: "ok" | "error" | "info";
  text: string;
  action?: NoticeAction;
};
export type ReorderMenu = { id: string; x: number; y: number };
export type AddMenu = { x: number; y: number };
export type AddMode =
  | { type: "append" }
  | { type: "insertAfter"; afterId: string }
  | { type: "chapterEnd"; afterId: string };
export type ExportSettings = {
  exportName: string;
  exportOrderMode: ExportOrderMode;
  randomSeed: string;
};
export type ModuleUpload = (kind: ModuleKind, file: File) => Promise<void>;
export type DropTarget = { id: string; position: DropPosition };
