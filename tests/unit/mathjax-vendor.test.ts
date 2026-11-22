import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "node_modules/@mathjax/mathjax-newcm-font/chtml");
const vendored = path.join(root, "public/vendor/mathjax-fonts/mathjax-newcm-font/chtml");

describe("MathJax vendored fonts", () => {
  // \mathbb 等按需加载 dynamic/*.js；缺文件会让整块预览的 typeset 失败、全部公式退回源码。
  it.each(["dynamic", "woff2"])("copies every %s file from the font package", (dir) => {
    const expected = readdirSync(path.join(source, dir)).sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(readdirSync(path.join(vendored, dir)).sort()).toEqual(expected);
  });
});
