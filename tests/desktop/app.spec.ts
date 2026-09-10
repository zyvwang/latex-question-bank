import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createEmptyBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";


test("persists an edited item in the packaged desktop runtime", async () => {
  const workspacePath = path.resolve(".tmp/playwright-desktop-workspace");
  const appDataPath = path.resolve(".tmp/playwright-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(path.join(workspacePath, ".tmp"), { recursive: true });
  await mkdir(path.join(workspacePath, ".history"), { recursive: true });
  await mkdir(path.join(workspacePath, "assets"), { recursive: true });
  await mkdir(path.join(workspacePath, "exports"), { recursive: true });
  await mkdir(appDataPath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createEmptyBank(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appDataPath, "app-state.json"),
    `${JSON.stringify({
      version: 1,
      currentWorkspacePath: workspacePath,
      recentWorkspacePaths: [workspacePath]
    }, null, 2)}\n`,
    "utf8"
  );

  const launchOptions = {
    args: ["."],
    env: {
      ...process.env,
      LQB_WORKSPACE_DIR: "",
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
    await page.getByRole("button", { name: "题库设置" }).click();
    await page.getByLabel("latexmk 路径").fill("desktop-latexmk-close-flush");
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
    await restartedPage.getByRole("button", { name: "题库设置" }).click();
    await expect(restartedPage.getByLabel("latexmk 路径"))
      .toHaveValue("desktop-latexmk-close-flush");
  } finally {
    await restartedApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
