import { deepStrictEqual } from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import {
  buildFullLatex,
  buildQuestionOnlyLatex,
  compileLatex,
  copyAssetsForItems,
  detectTexInstallation,
  orderItemsForExport
} from "../server/latex.js";
import { defaultSettings } from "../server/bank-schema.js";
import { getCurrentWorkspaceDirs } from "../server/workspace-storage.js";
import type { QuestionItem } from "../shared/types.js";

const workspaceDirs = await getCurrentWorkspaceDirs();
const workDir = path.join(workspaceDirs.tempDir, "verify-export");
const assetDir = workspaceDirs.assetDir;
const imageName = "verify-sample.png";
const sourceAssetPath = path.join(assetDir, imageName);

const tinyPng = createTinyPng();

await mkdir(assetDir, { recursive: true });
await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });
await writeFile(sourceAssetPath, tinyPng);

const now = new Date().toISOString();
const items: QuestionItem[] = [
  {
    id: "verify-1",
    order: 1,
    sourceNumber: "2024-1",
    chapter: "高等数学/极限",
    tags: ["极限", "等价无穷小"],
    star: 2,
    modules: {
      question: { tex: "求极限 $\\lim_{x\\to 0}\\frac{\\sin x}{x}$。" },
      solution: { tex: "由基本极限可得 $\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$。" },
      note: { tex: "这个基本极限可用于检查中文排版与公式渲染。" }
    },
    assets: [],
    createdAt: now,
    updatedAt: now
  },
  {
    id: "verify-2",
    order: 2,
    sourceNumber: "图像题",
    chapter: "线性代数/矩阵",
    tags: ["矩阵"],
    star: 4,
    modules: {
      question: {
        tex:
          "观察下图并判断矩阵秩。\n\n\\begin{center}\\includegraphics[width=0.15\\linewidth]{assets/verify-sample.png}\\end{center}"
      },
      solution: { tex: "图片引用用于验证素材复制和 graphicx 编译。" },
      note: { tex: "实际使用中可上传题目截图或辅助图。" }
    },
    assets: [
      {
        id: "asset-verify",
        fileName: imageName,
        originalName: imageName,
        relativePath: `assets/${imageName}`,
        mimeType: "image/png",
        size: tinyPng.byteLength,
        uploadedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  },
  {
    id: "verify-3",
    order: 3,
    sourceNumber: "TikZ",
    chapter: "高等数学/函数图像",
    tags: ["TikZ"],
    star: 5,
    modules: {
      question: {
        tex:
          "\\begin{center}\\begin{tikzpicture}[scale=0.8]\\draw[->] (-0.2,0)--(2,0);\\draw[->] (0,-0.2)--(0,2);\\draw[domain=0:1.4,smooth,variable=\\x,blue] plot ({\\x},{\\x*\\x});\\end{tikzpicture}\\end{center}"
      },
      solution: { tex: "TikZ 片段用于验证真实编译检查。" },
      note: { tex: "快速预览不渲染 TikZ，以 PDF 编译为准。" }
    },
    assets: [],
    createdAt: now,
    updatedAt: now
  }
];

const normalOrder = ["verify-1", "verify-2", "verify-3"];
const firstRandomOrder = orderItemsForExport(items, "random", "manual-seed").map((item) => item.id);
const secondRandomOrder = orderItemsForExport(items, "random", "manual-seed").map((item) => item.id);
const otherRandomOrder = orderItemsForExport(items, "random", "another-seed").map((item) => item.id);

deepStrictEqual(orderItemsForExport([...items].reverse(), "normal", "ignored").map((item) => item.id), normalOrder);
deepStrictEqual(secondRandomOrder, firstRandomOrder);
deepStrictEqual([...firstRandomOrder].sort(), [...normalOrder].sort());
deepStrictEqual([...otherRandomOrder].sort(), [...normalOrder].sort());

const exportItems = orderItemsForExport(items, "random", "compile-seed");
await copyAssetsForItems(exportItems, workDir);

const questionsPath = path.join(workDir, "questions.tex");
const fullPath = path.join(workDir, "full.tex");
await writeFile(questionsPath, buildQuestionOnlyLatex(exportItems, defaultSettings), "utf8");
await writeFile(fullPath, buildFullLatex(exportItems, defaultSettings), "utf8");

const texStatus = await detectTexInstallation();
if (!texStatus.available) {
  await rm(sourceAssetPath, { force: true });
  console.log(`Verification export skipped PDF compile: ${texStatus.message}`);
  console.log(`- ${questionsPath}`);
  console.log(`- ${fullPath}`);
  process.exit(0);
}

const questionResult = await compileLatex(questionsPath, workDir, 60_000);
const fullResult = await compileLatex(fullPath, workDir, 60_000);

if (!questionResult.ok || !fullResult.ok) {
  console.error(questionResult.log);
  console.error(fullResult.log);
  await rm(sourceAssetPath, { force: true });
  throw new Error("Verification export failed");
}

await rm(sourceAssetPath, { force: true });

console.log("Verification export passed:");
console.log(`- ${questionResult.pdfPath}`);
console.log(`- ${fullResult.pdfPath}`);

function createTinyPng(): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rawPixel = Buffer.from([0, 15, 118, 110, 255]);
  return Buffer.concat([signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(rawPixel)), pngChunk("IEND", Buffer.alloc(0))]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
