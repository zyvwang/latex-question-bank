import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { suggestImageSize, type ImageDimensions } from "../shared/image-size.js";
import type { AssetUploadResponse, QuestionAsset } from "../shared/types.js";
import {
  assertRealWorkspaceSubdir,
  resolveRealWorkspaceFile
} from "./workspace-paths.js";

const MAX_IMAGE_PIXELS = 25_000_000;

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface PreparedQuestionAsset extends ImageDimensions {
  asset: QuestionAsset;
  buffer: Buffer;
}

export class AssetUploadError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
  }
}

export async function prepareQuestionAsset(
  file: UploadedFile
): Promise<PreparedQuestionAsset> {
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

  const { width, height } = await validateImageContent(file.buffer);
  const fileName = `${crypto.randomUUID()}${imageType.safeExtension}`;
  const asset: QuestionAsset = {
    id: crypto.randomUUID(),
    fileName,
    originalName: file.originalname,
    relativePath: `assets/${fileName}`,
    mimeType: imageType.mimeType,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    sha256: createHash("sha256").update(file.buffer).digest("hex")
  };
  return { asset, buffer: file.buffer, width, height };
}

export async function writePreparedAsset(
  prepared: PreparedQuestionAsset,
  assetDir: string
): Promise<QuestionAsset> {
  await assertRealWorkspaceSubdir(assetDir);
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, prepared.asset.fileName), prepared.buffer);
  return prepared.asset;
}

export async function saveQuestionAsset(
  file: UploadedFile,
  assetDir: string
): Promise<AssetUploadResponse> {
  const prepared = await prepareQuestionAsset(file);
  const asset = await writePreparedAsset(prepared, assetDir);
  return {
    asset,
    url: `/assets/${asset.fileName}`,
    insertText: `\\qimg[${suggestImageSize(prepared)}]{assets/${asset.fileName}}`
  };
}

/**
 * Reads the pixel size of an existing workspace image from its header only.
 * Returns null for files that are missing, escape the workspace, or are not
 * PNG/JPEG, so callers can skip them instead of failing a whole batch.
 */
export async function readAssetDimensions(
  assetDir: string,
  relativePath: string
): Promise<ImageDimensions | null> {
  const prefix = "assets/";
  if (!relativePath.startsWith(prefix)) return null;
  try {
    const filePath = await resolveRealWorkspaceFile(assetDir, relativePath.slice(prefix.length));
    const buffer = await readFile(filePath);
    if (!detectImageType(buffer)) return null;
    const metadata = await sharp(buffer, { limitInputPixels: false }).metadata();
    if (!metadata.width || !metadata.height) return null;
    return { width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

function detectImageType(buffer: Buffer): {
  mimeType: "image/png" | "image/jpeg";
  safeExtension: ".png" | ".jpg";
  extensions: string[];
} | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
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

async function validateImageContent(buffer: Buffer): Promise<ImageDimensions> {
  try {
    // Metadata inspection allocates no pixel raster; reject oversized images before decoding.
    const metadata = await sharp(buffer, { limitInputPixels: false, failOn: "warning" }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("Missing image dimensions");
    if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new AssetUploadError("图片不能超过 2,500 万像素，请缩小图片后重试。", "IMAGE_DIMENSIONS_EXCEEDED");
    }
    // Force pixel decoding: valid headers alone do not establish image integrity.
    await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" }).stats();
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    if (error instanceof AssetUploadError) throw error;
    throw new AssetUploadError("图片内容损坏或不完整，请重新选择 PNG 或 JPEG 图片。", "IMAGE_CONTENT_INVALID");
  }
}
