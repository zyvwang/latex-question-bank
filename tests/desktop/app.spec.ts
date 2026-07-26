import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import type { Bank, LegacyBank } from "../../shared/types.js";

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

test("keeps MathJax previews working in the editor and heatmap", async () => {
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

    await page.getByRole("button", { name: "热力图" }).click();
    await expect(page.getByRole("heading", { name: "热力图" })).toBeVisible();
    await expect(page.locator("[data-heatmap-cell]")).toHaveCount(2);
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);

    await page.locator('[data-heatmap-cell="sample-linear-algebra"]').hover();
    await expect(page.getByRole("heading", { name: "示例 2" })).toBeVisible();
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
    await page.getByRole("tab", { name: /解析/ }).click();
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

test("keeps a 1000-item production heatmap responsive without virtualization", async () => {
  const workspacePath = path.resolve(".tmp/playwright-heatmap-workspace");
  const appDataPath = path.resolve(".tmp/playwright-heatmap-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(createLargeHeatmapBank(), null, 2)}\n`,
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
    const enteredAt = Date.now();
    await page.getByRole("button", { name: "热力图" }).click();
    await expect(page.locator("[data-heatmap-cell]")).toHaveCount(1000);
    expect(Date.now() - enteredAt).toBeLessThan(5000);
    await expect(page.locator('[aria-label="题目预览"]')).toHaveCount(1);

    const gridPane = page.getByRole("region", {
      name: "题目热力图滚动区域"
    });
    await gridPane.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => gridPane.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    const switchedAt = Date.now();
    await page.getByRole("button", { name: "错误原因", exact: true }).click();
    await expect(page.locator("[data-heatmap-mode='errorReason']")).toHaveCount(1000);
    expect(Date.now() - switchedAt).toBeLessThan(3000);

    await page.locator('[data-heatmap-cell="large-10-100"]').hover();
    await expect(page.getByRole("heading", { name: "10-100" })).toBeVisible();
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});

function createLegacyDesktopBank(): LegacyBank {
  const timestamp = "2026-07-26T08:00:00.000Z";
  return {
    version: 1,
    settings: {
      preamble: "",
      pageSize: "a4",
      spacing: { item: "1em", module: "0.5em" }
    },
    items: [
      {
        id: "legacy-desktop-item",
        order: 1,
        sourceNumber: "旧题 1",
        chapter: "旧章节",
        tags: ["旧标签"],
        star: 5,
        modules: {
          question: { tex: "求 $1+1$。" },
          solution: { tex: "$2$。" },
          note: { tex: "" }
        },
        assets: [],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  };
}

function createLargeHeatmapBank(): Bank {
  const base = createSampleBank();
  const chapters = Array.from({ length: 10 }, (_, index) => ({
    id: `large-chapter-${index + 1}`,
    name: `性能章节 ${index + 1}`,
    order: index + 1
  }));
  const template = base.items[0];
  const items = chapters.flatMap((chapter) =>
    Array.from({ length: 100 }, (_, index) => ({
      ...template,
      id: `large-${chapter.order}-${index + 1}`,
      sourceNumber: `${chapter.order}-${index + 1}`,
      chapterId: chapter.id,
      chapterOrder: index + 1,
      modules: {
        question: {
          tex: `性能题 $x_{${chapter.order},${index + 1}}$。`
        },
        solution: { tex: `答案为 $${chapter.order + index + 1}$。` },
        note: { tex: "" }
      }
    }))
  );
  return { ...base, chapters, items };
}
