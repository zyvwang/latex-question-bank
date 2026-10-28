import type { QuestionImageSize } from "./image-size.js";
import type { ModuleKind } from "./types.js";

export interface ImageNormalizeChange {
  id: string;
  source: string;
  module: ModuleKind;
  path: string;
  size: QuestionImageSize;
}

export interface ImageNormalizeWarning {
  id: string;
  source: string;
  path: string;
  reason: "unreadable";
}

export interface ImageNormalizeCounts {
  items: number;
  images: number;
  skipped: number;
}

export interface AgentImageNormalizeSummary {
  dryRun: boolean;
  revision: string;
  counts: ImageNormalizeCounts;
  changes: ImageNormalizeChange[];
  warnings: ImageNormalizeWarning[];
}
