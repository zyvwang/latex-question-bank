import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";

test("persists an edited item in the packaged desktop runtime", async () => {
  const workspacePath = path.resolve(".tmp/playwright-desktop-workspace");
  const appDataPath = path.resolve(".tmp/playwright-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });

  const launchOptions = {
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  };
  const electronApp = await electron.launch(launchOptions);

  try {
    const page = await electronApp.firstWindow();
    const browserWindow = await electronApp.browserWindow(page);
    await expect(page.getByText("当前工作区还没有题目")).toBeVisible();
    expect(await page.evaluate(() => Boolean(window.lqb))).toBe(true);
    const runtimePaths = await electronApp.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      sessionData: app.getPath("sessionData"),
      usesMockKeychain: app.commandLine.hasSwitch("use-mock-keychain")
    }));
    expect(path.resolve(runtimePaths.userData)).toBe(appDataPath);
    expect(path.resolve(runtimePaths.sessionData)).toBe(path.join(appDataPath, "session"));
    if (process.platform === "darwin") {
      expect(runtimePaths.usesMockKeychain).toBe(true);
    }
    await page.evaluate(() => {
      const testWindow = window as Window & { closeProbeCleanup?: () => void };
      testWindow.closeProbeCleanup = window.lqb?.onBeforeClose(async () => {
        document.body.dataset.closeProbe = "received";
      });
    });
    await browserWindow.evaluate((targetWindow) => {
      targetWindow.webContents.send("app:before-close");
    });
    await expect.poll(() => page.evaluate(() => document.body.dataset.closeProbe)).toBe("received");
    await page.evaluate(() => {
      const testWindow = window as Window & { closeProbeCleanup?: () => void };
      testWindow.closeProbeCleanup?.();
      delete testWindow.closeProbeCleanup;
    });
    await page.getByText("新增题目", { exact: true }).click();
    await page.getByLabel("原编号").fill("desktop-close-save");
    const exitPromise = new Promise<void>((resolve) => {
      electronApp.process().once("exit", () => resolve());
    });
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exitPromise;
    await expect
      .poll(async () => {
        const saved = JSON.parse(
          await readFile(path.join(workspacePath, "bank.json"), "utf8")
        ) as Bank;
        return saved.items[0]?.sourceNumber;
      })
      .toBe("desktop-close-save");
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }

  const restartedApp = await electron.launch(launchOptions);
  try {
    const restartedPage = await restartedApp.firstWindow();
    await expect(restartedPage.getByLabel("原编号")).toHaveValue("desktop-close-save");
  } finally {
    await restartedApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("keeps MathJax previews working after switching questions", async () => {
  const workspacePath = path.resolve(".tmp/playwright-preview-workspace");
  const appDataPath = path.resolve(".tmp/playwright-preview-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createSampleBank(), null, 2)}\n`,
    "utf8"
  );

  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: workspacePath,
      LQB_APP_DATA_DIR: appDataPath
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByLabel("原编号")).toHaveValue("示例 1");
    await expect
      .poll(() => page.locator('[role="tabpanel"] mjx-container').count())
      .toBeGreaterThan(0);

    await page.getByText("示例 2", { exact: true }).click();
    await expect(page.getByLabel("原编号")).toHaveValue("示例 2");
    await expect
      .poll(() => page.locator('[role="tabpanel"] mjx-container').count())
      .toBeGreaterThan(0);
    await page.getByRole("tab", { name: /解析/ }).click();
    await expect
      .poll(() => page.locator('[role="tabpanel"] mjx-container').count())
      .toBeGreaterThan(0);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
