import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";

test("explains an undo number conflict and allows retry after resolving it", async () => {
  const root = path.resolve(".tmp/playwright-undo-conflict");
  const workspacePath = path.join(root, "bank");
  const appDataPath = path.join(root, "app-data");
  await rm(root, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  const bank = createSampleBank();
  bank.items[0].sourceNumber = "42";
  bank.items[1].sourceNumber = "43";
  bank.items[1].chapterId = bank.items[0].chapterId;
  bank.items[1].chapterOrder = 2;
  await writeFile(path.join(workspacePath, "bank.json"), JSON.stringify(bank));
  const app = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_APP_DATA_DIR: appDataPath, LQB_WORKSPACE_DIR: workspacePath
  } });
  try {
    const page = await app.firstWindow();
    page.on("dialog", (dialog) => dialog.accept());
    await expect(page.getByLabel("原编号")).toHaveValue("42");
    await page.getByRole("button", { name: "删除题目", exact: true }).click();
    await expect(page.getByLabel("原编号")).toHaveValue("43");
    await page.getByLabel("原编号").fill("42");
    await page.getByLabel("原编号").press("Tab");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByText("无法撤销：原编号“42”已被目标章节中的其他题目使用。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "撤销", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "导出 1 题", exact: true })).toBeVisible();
    await page.getByLabel("原编号").fill("43");
    await page.getByLabel("原编号").press("Tab");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.getByLabel("原编号")).toHaveValue("42");
    await expect(page.getByText("已撤销删除。", { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(path.join(workspacePath, "bank.json"), "utf8")) as Bank;
      return saved.items.map((item) => item.sourceNumber).sort();
    }).toEqual(["42", "43"]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
