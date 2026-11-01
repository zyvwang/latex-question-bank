import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const srcDir = path.resolve("src");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(target);
    return entry.name.endsWith(".css") ? [target] : [];
  });
}

const files = cssFiles(srcDir);
const foundation = readFileSync(path.join(srcDir, "styles/foundation.css"), "utf8");
const defined = new Set([...foundation.matchAll(/(--[a-z0-9-]+):/g)].map((match) => match[1]));
// 这些变量由组件内联写入或带回退值，不属于皮肤约定。
const runtime = new Set(["--question-sidebar-width", "--module-editor-percent", "--row-height"]);

it("keeps colors in the skin tokens instead of component styles", () => {
  const offenders = files
    .filter((file) => !file.endsWith("foundation.css"))
    .flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /#[0-9a-fA-F]{3,8}\b|oklch\(|rgba?\(|:\s*(white|black)\b/.test(line))
        .map((line) => `${path.relative(srcDir, file)}: ${line.trim()}`)
    );
  expect(offenders).toEqual([]);
});

it("only references defined style tokens", () => {
  const unknown = files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/var\((--[a-z0-9-]+)/g)]
      .map((match) => match[1]!)
      .filter((name) => !defined.has(name) && !runtime.has(name))
      .map((name) => `${path.relative(srcDir, file)}: ${name}`)
  );
  expect(unknown).toEqual([]);
});
