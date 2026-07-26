import { deepStrictEqual, equal } from "node:assert";
import type { PathLike } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonFileAtomic } from "../../server/json-file.js";

/**
 * 要区分「直接覆盖 .bak」和「写临时文件再 rename」两种实现,失败必须发生在
 * 备份写到一半的时刻 —— 立即抛错的 copyFile 两种实现都能全身而退。所以这里在
 * 模块边界上注入一个「先写半截再抛」的 copyFile,其余调用透传给真实实现。
 * 单独一个测试文件是为了把这个模块级 mock 关在这里,不影响 domain.test.ts。
 */
const copyFileControl = vi.hoisted(() => ({ failing: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    copyFile: async (source: PathLike, destination: PathLike, mode?: number) => {
      if (!copyFileControl.failing) {
        return actual.copyFile(source, destination, mode);
      }
      await actual.writeFile(destination, '{\n  "version": 1,\n  "val');
      throw Object.assign(new Error("copy interrupted"), { code: "EIO" });
    }
  };
});

describe("writeJsonFileAtomic", () => {
  const directory = path.resolve(".tmp/vitest-json-file");
  const filePath = path.join(directory, "bank.json");
  const backupPath = `${filePath}.bak`;

  beforeEach(async () => {
    copyFileControl.failing = false;
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
  });

  it("keeps the previous backup intact when the backup copy fails mid-write", async () => {
    await writeJsonFileAtomic(filePath, { version: 1, value: "first" });
    await writeJsonFileAtomic(filePath, { version: 1, value: "second" });
    equal(readValue(await readFile(backupPath, "utf8")), "first");

    copyFileControl.failing = true;
    await expect(
      writeJsonFileAtomic(filePath, { version: 1, value: "third" })
    ).rejects.toThrow(/copy interrupted/);

    // .bak 是 bank.json 损坏时唯一的恢复源,而且损坏是静默的:recovery-storage
    // 解析失败只会让这个候选从列表里消失,用户看不到「备份坏了」这件事。
    equal(readValue(await readFile(backupPath, "utf8")), "first");
    equal(readValue(await readFile(filePath, "utf8")), "second");
    deepStrictEqual(
      (await readdir(directory)).sort(),
      ["bank.json", "bank.json.bak"]
    );
  });

  it("leaves no backup temp file behind on a successful write", async () => {
    await writeJsonFileAtomic(filePath, { version: 1, value: "first" });
    await writeJsonFileAtomic(filePath, { version: 1, value: "second" });

    deepStrictEqual(
      (await readdir(directory)).sort(),
      ["bank.json", "bank.json.bak"]
    );
  });
});

function readValue(raw: string): string {
  return (JSON.parse(raw) as { value: string }).value;
}
