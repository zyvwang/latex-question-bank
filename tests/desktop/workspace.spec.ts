import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank } from "../../shared/types.js";
import { createLegacyDesktopBank } from "../fixtures/desktop-app.js";

test("starts in Setup, creates a workspace, and removes only its recent-list entry", async () => {
  const workspacePath = path.resolve(".tmp/playwright-setup-workspace");
  const appDataPath = path.resolve(".tmp/playwright-setup-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });

  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      LQB_APP_DATA_DIR: appDataPath,
      LQB_WORKSPACE_DIR: ""
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByText("建立你的第一个题库")).toBeVisible();
    await electronApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath]
      });
    }, workspacePath);
    await page.getByRole("button", { name: "新建空白题库" }).click();
    await expect(page.getByText("当前工作区还没有题目")).toBeVisible();
    await expect.poll(async () => readFile(path.join(workspacePath, "bank.json"), "utf8"))
      .toContain('"version": 2');

    await page.getByRole("button", { name: "题库设置" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "从列表移除工作区" }).click();
    await expect(page.getByText("建立你的第一个题库")).toBeVisible();
    await expect(readFile(path.join(workspacePath, "bank.json"), "utf8"))
      .resolves.toContain('"version": 2');
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("switches away from a missing current workspace without changing disk data", async () => {
  const missingWorkspacePath = path.resolve(
    ".tmp/playwright-missing-workspace"
  );
  const availableWorkspacePath = path.resolve(
    ".tmp/playwright-available-workspace"
  );
  const appDataPath = path.resolve(
    ".tmp/playwright-missing-workspace-app-data"
  );
  await Promise.all([
    rm(missingWorkspacePath, { recursive: true, force: true }),
    rm(availableWorkspacePath, { recursive: true, force: true }),
    rm(appDataPath, { recursive: true, force: true })
  ]);
  await Promise.all([
    mkdir(availableWorkspacePath, { recursive: true }),
    mkdir(appDataPath, { recursive: true })
  ]);
  await writeFile(
    path.join(availableWorkspacePath, "bank.json"),
    `${JSON.stringify(createSampleBank(), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(appDataPath, "app-state.json"),
    `${JSON.stringify({
      version: 1,
      currentWorkspacePath: missingWorkspacePath,
      recentWorkspacePaths: [
        missingWorkspacePath,
        availableWorkspacePath
      ]
    }, null, 2)}\n`,
    "utf8"
  );

  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      LQB_APP_DATA_DIR: appDataPath,
      LQB_WORKSPACE_DIR: ""
    }
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByText("原题库位置已失效")).toBeVisible();
    await page.getByRole("button", {
      name: `切换到 ${path.basename(availableWorkspacePath)}`
    }).click();
    await expect(page.getByLabel("原编号")).toHaveValue("示例 1");
    await expect.poll(async () => {
      const state = JSON.parse(
        await readFile(path.join(appDataPath, "app-state.json"), "utf8")
      ) as { currentWorkspacePath?: string };
      return state.currentWorkspacePath;
    }).toBe(availableWorkspacePath);
    await expect(
      page.getByText("原题库位置已失效")
    ).not.toBeVisible();
  } finally {
    await electronApp.close();
  }
});

test("opens v1, saves the first edit as v2 on close, and restarts from v2", async () => {
  const workspacePath = path.resolve(".tmp/playwright-v1-workspace");
  const appDataPath = path.resolve(".tmp/playwright-v1-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createLegacyDesktopBank(), null, 2)}\n`,
    "utf8"
  );

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
    await expect(page.getByLabel("原编号")).toHaveValue("旧题 1");
    expect(JSON.parse(await readFile(path.join(workspacePath, "bank.json"), "utf8")).version)
      .toBe(1);
    await page.getByLabel("原编号").fill("旧题 1（已编辑）");

    const exitPromise = new Promise<void>((resolve) => {
      electronApp.process().once("exit", () => resolve());
    });
    await electronApp.evaluate(({ app }) => app.quit()).catch(() => undefined);
    await exitPromise;
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }

  const savedBank = JSON.parse(
    await readFile(path.join(workspacePath, "bank.json"), "utf8")
  ) as Bank;
  expect(savedBank.version).toBe(2);
  expect(savedBank.items[0]).toMatchObject({
    sourceNumber: "旧题 1（已编辑）",
    masteryOptionId: null,
    errorReasonOptionIds: []
  });
  expect(
    JSON.parse(await readFile(path.join(workspacePath, "bank.json.bak"), "utf8")).version
  ).toBe(1);

  const restartedApp = await electron.launch(launchOptions);
  try {
    const restartedPage = await restartedApp.firstWindow();
    await expect(restartedPage.getByLabel("原编号")).toHaveValue("旧题 1（已编辑）");
  } finally {
    await restartedApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
