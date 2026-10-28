import type { AgentImageNormalizeSummary } from "../shared/agent-images.js";
import type { ImageDimensions } from "../shared/image-size.js";
import { collectLegacyImagePaths, planImageNormalize } from "./agent-image-plan.js";
import { commitBank, withCurrentBank } from "./agent-bank-write.js";
import { readAssetDimensions } from "./asset-service.js";
import { broadcastBankChanged } from "./events.js";

export interface AgentImageNormalizeInput {
  workspacePath: string;
  dryRun: boolean;
  baseRevision?: string;
}

// 图片规范化改的是题目内容，所以和考点整理不同：写入前总是拍 .history/ 快照，
// 用户可以在应用的恢复入口回到改写前。审阅状态不变，因为只是机械替换图片写法。
export async function normalizeAgentImages(
  input: AgentImageNormalizeInput
): Promise<AgentImageNormalizeSummary> {
  return withCurrentBank(
    input,
    "图片规范化的目标不是当前题库，请先切换工作区。",
    async (context) => {
      const dimensions = new Map<string, ImageDimensions>();
      for (const imagePath of collectLegacyImagePaths(context.current)) {
        const size = await readAssetDimensions(context.dirs.assetDir, imagePath);
        if (size) dimensions.set(imagePath, size);
      }
      const plan = planImageNormalize({
        current: context.current,
        dimensions,
        now: new Date().toISOString()
      });
      const summary: AgentImageNormalizeSummary = {
        dryRun: input.dryRun,
        revision: context.revision,
        counts: plan.counts,
        changes: plan.changes,
        warnings: plan.warnings
      };
      if (input.dryRun || plan.changes.length === 0) return summary;

      const revision = await commitBank(context, plan.bank, { snapshot: true });
      try {
        broadcastBankChanged({
          workspacePath: context.workspacePath,
          revision,
          source: "agent-images",
          imageCounts: plan.counts
        });
      } catch {
        // A renderer event is best-effort; the write itself is already durable.
      }
      return { ...summary, revision };
    }
  );
}
