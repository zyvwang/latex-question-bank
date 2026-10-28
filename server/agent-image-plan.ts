import type {
  ImageNormalizeChange,
  ImageNormalizeCounts,
  ImageNormalizeWarning
} from "../shared/agent-images.js";
import { suggestImageSize, type ImageDimensions } from "../shared/image-size.js";
import { questionSourceDisplay } from "../shared/question-source.js";
import type { Bank, ModuleKind } from "../shared/types.js";

export interface ImageNormalizePlan {
  bank: Bank;
  changes: ImageNormalizeChange[];
  warnings: ImageNormalizeWarning[];
  counts: ImageNormalizeCounts;
}

const MODULE_KINDS: ModuleKind[] = ["question", "solution", "note"];

// 只认旧版上传按钮插入的默认写法（固定 0.75 栏宽，可带 center）。用户手调过宽度的图片保持原样。
const LEGACY_WIDTH = String.raw`\\includegraphics\[\s*width\s*=\s*0\.75\\linewidth\s*\]\{(assets/[^{}]+)\}`;
const LEGACY_IMAGE_PATTERN = new RegExp(
  String.raw`\\begin\{center\}\s*${LEGACY_WIDTH}\s*\\end\{center\}|${LEGACY_WIDTH}`,
  "g"
);

export function collectLegacyImagePaths(bank: Bank): string[] {
  const paths = new Set<string>();
  for (const item of bank.items) {
    for (const kind of MODULE_KINDS) {
      for (const match of item.modules[kind].tex.matchAll(LEGACY_IMAGE_PATTERN)) {
        paths.add(match[1] ?? match[2]);
      }
    }
  }
  return [...paths];
}

/**
 * Rewrites legacy fixed-width images to `\qimg[size]{path}`. Images whose
 * dimensions are unknown are left untouched and reported as warnings.
 */
export function planImageNormalize(input: {
  current: Bank;
  dimensions: ReadonlyMap<string, ImageDimensions>;
  now: string;
}): ImageNormalizePlan {
  const changes: ImageNormalizeChange[] = [];
  const warnings: ImageNormalizeWarning[] = [];
  const items = input.current.items.map((item) => {
    const source = questionSourceDisplay(item, input.current.books) || item.id;
    let changed = false;
    const modules = { ...item.modules };
    for (const kind of MODULE_KINDS) {
      const tex = item.modules[kind].tex.replace(
        LEGACY_IMAGE_PATTERN,
        (whole, centeredPath: string | undefined, barePath: string | undefined) => {
          const imagePath = centeredPath ?? barePath ?? "";
          const dimensions = input.dimensions.get(imagePath);
          if (!dimensions) {
            warnings.push({ id: item.id, source, path: imagePath, reason: "unreadable" });
            return whole;
          }
          const size = suggestImageSize(dimensions);
          changes.push({ id: item.id, source, module: kind, path: imagePath, size });
          return String.raw`\qimg[${size}]{${imagePath}}`;
        }
      );
      if (tex !== item.modules[kind].tex) {
        modules[kind] = { tex };
        changed = true;
      }
    }
    return changed ? { ...item, modules, updatedAt: input.now } : item;
  });

  const changedIds = new Set(changes.map((change) => change.id));
  return {
    bank: { ...input.current, items },
    changes,
    warnings,
    counts: {
      items: changedIds.size,
      images: changes.length,
      skipped: warnings.length
    }
  };
}
