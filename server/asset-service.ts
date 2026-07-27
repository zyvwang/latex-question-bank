import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetUploadResponse, QuestionAsset } from "../shared/types.js";
import { assertRealWorkspaceSubdir } from "./workspace-paths.js";
import { getCurrentWorkspaceDirs } from "./workspace-storage.js";

interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export class AssetUploadError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
  }
}

export async function saveQuestionAsset(file: UploadedFile): Promise<AssetUploadResponse> {
  const imageType = detectImageType(file.buffer);
  if (!imageType) {
    throw new AssetUploadError("图片内容不是有效的 PNG 或 JPEG。", "IMAGE_SIGNATURE_INVALID");
  }
  if (file.mimetype !== imageType.mimeType) {
    throw new AssetUploadError("图片 MIME 类型与文件内容不匹配。", "IMAGE_MIME_MISMATCH");
  }

  const originalExtension = path.extname(file.originalname).toLowerCase();
  if (!imageType.extensions.includes(originalExtension)) {
    throw new AssetUploadError("图片扩展名与文件内容不匹配。", "IMAGE_EXTENSION_MISMATCH");
  }

  const { assetDir } = await getCurrentWorkspaceDirs();
  await assertRealWorkspaceSubdir(assetDir);
  await mkdir(assetDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}${imageType.safeExtension}`;
  await writeFile(path.join(assetDir, fileName), file.buffer);

  const asset: QuestionAsset = {
    id: crypto.randomUUID(),
    fileName,
    originalName: file.originalname,
    relativePath: `assets/${fileName}`,
    mimeType: imageType.mimeType,
    size: file.size,
    uploadedAt: new Date().toISOString()
  };

  return {
    asset,
    url: `/assets/${asset.fileName}`,
    insertText: `\\begin{center}\n\\includegraphics[width=0.75\\linewidth]{assets/${asset.fileName}}\n\\end{center}`
  };
}

function detectImageType(buffer: Buffer): {
  mimeType: "image/png" | "image/jpeg";
  safeExtension: ".png" | ".jpg";
  extensions: string[];
} | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: "image/png", safeExtension: ".png", extensions: [".png"] };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return {
      mimeType: "image/jpeg",
      safeExtension: ".jpg",
      extensions: [".jpg", ".jpeg"]
    };
  }
  return null;
}
