import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mathJaxSource = path.join(root, "node_modules", "mathjax");
const mathJaxTarget = path.join(root, "public", "vendor", "mathjax");
const fontSource = path.join(
  root,
  "node_modules",
  "@mathjax",
  "mathjax-newcm-font",
  "chtml"
);
const fontVendorTarget = path.join(root, "public", "vendor", "mathjax-fonts");
// 必须连同 dynamic/ 一起复制：\mathbb、\mathcal 等字形按需加载这些脚本，
// 缺一个文件整次 typeset 都会 reject，整块预览退回源码。
const fontTarget = path.join(fontVendorTarget, "mathjax-newcm-font", "chtml");

await mkdir(path.dirname(mathJaxTarget), { recursive: true });
await rm(mathJaxTarget, { recursive: true, force: true });
await cp(mathJaxSource, mathJaxTarget, { recursive: true });

await rm(fontVendorTarget, { recursive: true, force: true });
await mkdir(path.dirname(fontTarget), { recursive: true });
await cp(fontSource, fontTarget, { recursive: true });
