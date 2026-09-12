import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createSampleBank } from "../../server/bank-schema.js";

import { closeDesktopApp, isMissingFile, createLargeHeatmapBank, installMessageBoxRecorder, readMessageBoxCalls } from "../fixtures/desktop-app.js";

test("restores adjusted and collapsed panes after a desktop restart", async () => {
  const workspacePath = path.resolve(".tmp/playwright-layout-workspace");
  const appDataPath = path.resolve(".tmp/playwright-layout-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createSampleBank(), null, 2)}\n`,
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
    const sidebarSeparator = page.getByRole("separator", {
      name: "调整题目侧栏宽度"
    });
    await expect(sidebarSeparator).toBeVisible();
    await sidebarSeparator.press("End");
    await page.getByRole("separator", { name: "调整代码与预览比例" }).press("Home");

    await page.getByRole("button", { name: "热力图" }).click();
    const previewSeparator = page.getByRole("separator", {
      name: "调整热力图题目预览宽度"
    });
    await previewSeparator.press("End");
    await page.getByRole("button", { name: "收起热力图题目预览" }).click();

    await expect.poll(async () => {
      try {
        const state = JSON.parse(
          await readFile(path.join(appDataPath, "app-state.json"), "utf8")
        ) as { uiLayout?: Record<string, unknown> };
        return state.uiLayout;
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    }).toMatchObject({
      questionSidebarWidth: 360,
      moduleEditorPercent: 35,
      heatmapPreviewWidth: 520,
      heatmapPreviewCollapsed: true
    });
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }

  const restartedApp = await electron.launch(launchOptions);
  try {
    const page = await restartedApp.firstWindow();
    await expect(page.getByRole("separator", {
      name: "调整题目侧栏宽度"
    })).toHaveAttribute("aria-valuenow", "360");
    await expect(page.getByRole("separator", {
      name: "调整代码与预览比例"
    })).toHaveAttribute("aria-valuenow", "35");

    await page.getByRole("button", { name: "热力图" }).click();
    await expect(page.getByRole("button", {
      name: "展开热力图题目预览"
    })).toBeVisible();
    await page.getByRole("button", { name: "展开热力图题目预览" }).click();
    await expect(page.getByRole("separator", {
      name: "调整热力图题目预览宽度"
    })).toHaveAttribute("aria-valuenow", "520");
  } finally {
    await restartedApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("sidebar chapter headings stick, hand off, and preserve keyboard and drag targets", async () => {
  const workspacePath = path.resolve(".tmp/playwright-chapter-sidebar-workspace");
  const appDataPath = path.resolve(".tmp/playwright-chapter-sidebar-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(workspacePath, { recursive: true });
  const bank = createLargeHeatmapBank();
  bank.chapters = bank.chapters.slice(0, 3);
  bank.chapters[1].name = "第二章：含参数的分段函数连续性与极限的分类讨论";
  bank.items = bank.items.filter((item) =>
    bank.chapters.some((chapter) => chapter.id === item.chapterId) && item.chapterOrder <= 16
  );
  await writeFile(path.join(workspacePath, "bank.json"), JSON.stringify(bank));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, LQB_APP_DATA_DIR: appDataPath, LQB_WORKSPACE_DIR: workspacePath }
  });
  try {
    const page = await app.firstWindow();
    const list = page.getByLabel("题目列表", { exact: true });
    const headings = list.getByRole("heading");
    await expect(headings).toHaveCount(3);
    const geometry = () => list.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      headings: Array.from(element.querySelectorAll("h3")).map((h) => ({
        top: h.getBoundingClientRect().top, bottom: h.getBoundingClientRect().bottom
      }))
    }));
    await list.evaluate((element) => { element.scrollTop = 200; });
    let bounds = await geometry();
    expect(Math.abs(bounds.headings[0].top - bounds.top)).toBeLessThan(2);
    await list.evaluate((element) => {
      const next = element.querySelectorAll("h3")[1];
      element.scrollTop += next.getBoundingClientRect().top -
        element.getBoundingClientRect().top - 12;
    });
    bounds = await geometry();
    expect(bounds.headings[0].top).toBeLessThan(bounds.top);
    expect(Math.abs(bounds.headings[0].bottom - bounds.headings[1].top)).toBeLessThan(2);
    await list.evaluate((element) => { element.scrollTop += 80; });
    bounds = await geometry();
    expect(Math.abs(bounds.headings[1].top - bounds.top)).toBeLessThan(2);

    const separator = page.getByRole("separator", { name: "调整题目侧栏宽度" });
    // The sidebar's minimum width must still show the full wrapped heading.
    await separator.press("Home");
    await expect(headings.nth(1)).toHaveCSS("white-space", "normal");
    const target = page.locator("#question-nav-large-2-3");
    await target.focus();
    const targetBox = await target.boundingBox();
    bounds = await geometry();
    expect(targetBox!.y).toBeGreaterThanOrEqual(bounds.headings[1].bottom);

    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    bounds = await geometry();
    expect(Math.abs(bounds.headings[2].top - bounds.top)).toBeLessThan(2);
    await list.evaluate((element) => { element.scrollTop = 0; });
    bounds = await geometry();
    expect(Math.abs(bounds.headings[0].top - bounds.top)).toBeLessThan(2);

    const row = list.locator('[data-question-id="large-1-1"]');
    const handle = row.getByTitle("拖拽排序");
    const handleBox = await handle.boundingBox();
    const headingBox = await headings.first().boundingBox();
    await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
    await page.mouse.down();
    await page.mouse.move(headingBox!.x + 20, headingBox!.y + 10);
    await page.mouse.up();
    await expect(list.locator("[data-question-id]").first()).toHaveAttribute("data-question-id", "large-1-1");
    const secondBox = await list.locator('[data-question-id="large-1-2"]').boundingBox();
    await page.mouse.move(handleBox!.x + 10, handleBox!.y + 10);
    await page.mouse.down();
    await page.mouse.move(secondBox!.x + 30, secondBox!.y + secondBox!.height - 5);
    await page.mouse.up();
    await expect(list.locator("[data-question-id]").first()).toHaveAttribute("data-question-id", "large-1-2");
  } finally {
    await closeDesktopApp(app);
    await rm(workspacePath, { recursive: true, force: true });
    await rm(appDataPath, { recursive: true, force: true, maxRetries: 3 });
  }
});


test("reports layout write failures, blocks close, and retries without changing bank save state", async () => {
  const directory = path.resolve(".tmp/playwright-layout-failure");
  const workspacePath = path.join(directory, "workspace");
  const appDataPath = path.join(directory, "app-data");
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(path.join(workspacePath, "bank.json"), JSON.stringify(createSampleBank()));
  const electronApp = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_WORKSPACE_DIR: workspacePath, LQB_APP_DATA_DIR: appDataPath
  } });
  try {
    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1470, height: 891 });
    const separator = page.getByRole("separator", { name: "调整题目侧栏宽度" });
    await expect(separator).toBeVisible();
    const statePath = path.join(appDataPath, "app-state.json");
    await separator.press("Home");
    await expect.poll(async () => readFile(statePath, "utf8").catch(() => "")).toContain("uiLayout");
    await rename(statePath, `${statePath}.held`);
    await mkdir(statePath);
    await separator.press("End");
    const retry = page.getByRole("button", { name: "布局未保存 · 重试" });
    await expect(retry).toBeVisible();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(directory, "layout-error-wide.png") });
    await page.setViewportSize({ width: 760, height: 891 });
    await expect(retry).toBeVisible();
    await page.screenshot({ path: path.join(directory, "layout-error-narrow.png") });
    await installMessageBoxRecorder(electronApp, 0);
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => readMessageBoxCalls(electronApp)).toHaveLength(1);
    expect((await readMessageBoxCalls(electronApp))[0].detail).toContain("界面布局未保存");
    await rm(statePath, { recursive: true });
    await rename(`${statePath}.held`, statePath);
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect.poll(async () => JSON.parse(await readFile(statePath, "utf8")).uiLayout.questionSidebarWidth).toBe(360);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
