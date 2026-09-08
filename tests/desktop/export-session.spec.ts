import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import type { SaveBankRequest } from "../../shared/types.js";

test("cancels a delayed export when the user switches workspaces", async () => {
  const root = path.resolve(".tmp/playwright-export-session");
  const appDataPath = path.join(root, "app-data");
  const a = path.join(root, "A");
  const b = path.join(root, "B");
  await rm(root, { recursive: true, force: true });
  const original = createSampleBank();
  const other = createSampleBank();
  other.items[0].sourceNumber = "B-only";
  for (const [workspace, bank] of [[a, original], [b, other]] as const) {
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "bank.json"), JSON.stringify(bank));
  }
  await mkdir(appDataPath, { recursive: true });
  await writeFile(path.join(appDataPath, "app-state.json"), JSON.stringify({
    version: 1, currentWorkspacePath: a, recentWorkspacePaths: [a, b]
  }));
  const bBefore = await readFile(path.join(b, "bank.json"), "utf8");
  const app = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_APP_DATA_DIR: appDataPath, LQB_WORKSPACE_DIR: ""
  } });
  let releaseName!: () => void;
  const delayedName = new Promise<void>((resolve) => { releaseName = resolve; });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("原编号")).toHaveValue("示例 1");
    await expect(page.getByLabel("导出名")).not.toHaveValue("");
    const writes: SaveBankRequest[] = [];
    let exportRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/bank") && request.method() === "PUT") writes.push(request.postDataJSON());
      if (request.url().endsWith("/api/export")) exportRequests += 1;
    });
    let intercepted!: () => void;
    const entered = new Promise<void>((resolve) => { intercepted = resolve; });
    let first = true;
    await page.route("**/api/exports/default-name", async (route) => {
      if (!first) { await route.continue(); return; }
      first = false;
      intercepted();
      await delayedName;
      await route.fulfill({ json: { exportName: "stale-export" } });
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "导出 2 题", exact: true }).click();
    await entered;
    await page.getByRole("button", { name: "题库设置", exact: true }).click();
    await page.getByRole("button", { name: "B 本地工作区", exact: true }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("原编号")).toHaveValue("B-only");
    const oldResponse = page.waitForResponse(async (response) => response.url().endsWith("/api/exports/default-name") && (await response.json()).exportName === "stale-export");
    releaseName();
    await oldResponse;
    // A subsequent renderer task observes the completed fetch continuation, without a guessed delay.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(page.getByRole("button", { name: "导出 2 题", exact: true })).toBeEnabled();
    await expect(page.getByLabel("导出名")).not.toHaveValue("stale-export");
    expect(exportRequests).toBe(0);
    expect(writes).toEqual([]);
    expect(await readFile(path.join(b, "bank.json"), "utf8")).toBe(bBefore);
  } finally {
    releaseName();
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
