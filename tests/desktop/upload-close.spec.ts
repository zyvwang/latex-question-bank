import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";

test("returns to editing when closing during upload and saves the completed insertion on retry", async () => {
  const root = path.resolve(".tmp/playwright-upload-close");
  const workspace = path.join(root, "bank");
  await rm(root, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "bank.json"), JSON.stringify(createSampleBank()));
  const app = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_APP_DATA_DIR: path.join(root, "app-data"), LQB_WORKSPACE_DIR: workspace
  } });
  let resume!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const requested = new Promise<void>((resolve) => { started = resolve; });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("原编号")).toBeVisible();
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: [Electron.MessageBoxOptions] | [Electron.BaseWindow, Electron.MessageBoxOptions]) => {
        const options = args.length === 2 ? args[1] : args[0];
        Object.assign(globalThis, { __uploadCloseMessage: options.detail });
        return { response: 0, checkboxChecked: false };
      };
    });
    await page.route("**/api/assets", async (route) => { started(); await gate; await route.continue(); });
    await page.locator('input[type="file"]').setInputFiles({
      name: "pixel.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64")
    });
    await requested;
    await app.evaluate(({ app }) => app.quit());
    await expect.poll(() => app.evaluate(() =>
      (globalThis as typeof globalThis & { __uploadCloseMessage?: string }).__uploadCloseMessage
    )).toContain("图片仍在上传");
    await expect(page.getByLabel("原编号")).toBeVisible();
    resume();
    await expect(page.getByText("图片已插入当前模块。", { exact: true })).toBeVisible();
    const closed = app.waitForEvent("close");
    await app.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await closed;
    const saved = JSON.parse(await readFile(path.join(workspace, "bank.json"), "utf8")) as Bank;
    expect(saved.items[0].assets).toHaveLength(1);
    expect(saved.items[0].modules.question.tex).toContain(saved.items[0].assets[0].relativePath);
  } finally {
    resume();
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
