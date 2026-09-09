import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";

test("keeps the editor inert during save-as and copies the latest local bank", async () => {
  const root = path.resolve(".tmp/playwright-conflict-save-as");
  const workspacePath = path.join(root, "source");
  const targetPath = path.join(root, "copy");
  await rm(root, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  const bank = createSampleBank();
  await writeFile(path.join(workspacePath, "bank.json"), JSON.stringify(bank));
  const app = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_APP_DATA_DIR: path.join(root, "app-data"), LQB_WORKSPACE_DIR: workspacePath
  } });
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("原编号")).toHaveValue(bank.items[0].sourceNumber!);
    bank.settings.preamble += "\n% external edit";
    await writeFile(path.join(workspacePath, "bank.json"), JSON.stringify(bank));
    await page.getByLabel("原编号").fill("另存前修改");
    await page.getByLabel("原编号").press("Tab");
    await expect(page.getByRole("dialog", { name: "题库保存冲突" })).toBeVisible();
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    }, targetPath);
    await page.route("**/api/workspaces/save-as", async (route) => {
      await gate;
      await route.continue();
    });
    await page.getByRole("button", { name: "另存为新题库" }).click();
    await expect(page.getByRole("button", { name: "暂时关闭" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await page.keyboard.type("unexpected edit");
    expect(await page.getByLabel("原编号").evaluate((element) => Boolean(element.closest("[inert]")))).toBe(true);
    await expect(page.getByRole("dialog", { name: "题库保存冲突" })).toBeVisible();
    resume();
    await expect(page.getByRole("dialog", { name: "题库保存冲突" })).toHaveCount(0);
    await expect(page.getByLabel("原编号")).toHaveValue("另存前修改");
    const saved = JSON.parse(await readFile(path.join(targetPath, "bank.json"), "utf8")) as Bank;
    expect(saved.items[0].sourceNumber).toBe("另存前修改");
    expect(saved.settings.preamble).not.toContain("external edit");
    expect(JSON.parse(await readFile(path.join(workspacePath, "bank.json"), "utf8"))).toEqual(bank);
  } finally {
    resume();
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
