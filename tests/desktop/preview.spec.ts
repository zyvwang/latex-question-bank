import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createSampleBank } from "../../server/bank-schema.js";

import { createLargeHeatmapBank } from "../fixtures/desktop-app.js";

test("keeps MathJax previews working in the editor and heatmap", async () => {
  const workspacePath = path.resolve(".tmp/playwright-preview-workspace");
  const appDataPath = path.resolve(".tmp/playwright-preview-app-data");
  await rm(workspacePath, { recursive: true, force: true });
  await rm(appDataPath, { recursive: true, force: true });
  await mkdir(workspacePath, { recursive: true });
  const previewBank = createSampleBank();
  previewBank.items[0].modules.question.tex =
    `\\[${Array.from({ length: 48 }, (_, index) => `x_{${index + 1}}`).join(" + ")}\\]`;
  await writeFile(
    path.join(workspacePath, "bank.json"),
    `${JSON.stringify(previewBank, null, 2)}\n`,
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
    const editorPreview = page.locator('[role="tabpanel"] [data-latex-preview]');
    await expect
      .poll(() => editorPreview.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      ))
      .toBeGreaterThan(0);
    await expect
      .poll(() => editorPreview.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: 120
        }));
        return element.scrollLeft;
      }))
      .toBeGreaterThan(0);
    await expect
      .poll(() => editorPreview.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: 120,
          shiftKey: true
        }));
        return element.scrollLeft;
      }))
      .toBeGreaterThan(0);

    const mathJaxStats = await page.evaluate(() => {
      const mathJax = window.MathJax;
      if (!mathJax?.typesetPromise) throw new Error("MathJax 尚未加载");
      const stats = { active: 0, maxActive: 0, calls: 0, clears: 0 };
      const originalTypeset = mathJax.typesetPromise.bind(mathJax);
      const originalClear = mathJax.typesetClear?.bind(mathJax);
      mathJax.typesetPromise = async (elements) => {
        stats.active += 1;
        stats.maxActive = Math.max(stats.maxActive, stats.active);
        stats.calls += 1;
        try {
          await originalTypeset(elements);
        } finally {
          stats.active -= 1;
        }
      };
      mathJax.typesetClear = (elements) => {
        stats.clears += 1;
        originalClear?.(elements);
      };
      const testWindow = window as Window & {
        __mathJaxTypesetStats?: typeof stats;
      };
      testWindow.__mathJaxTypesetStats = stats;
      return true;
    });
    expect(mathJaxStats).toBe(true);
    const editor = page.locator(".cm-content[contenteditable='true']");
    const wideEquation = Array.from(
      { length: 48 },
      (_, index) => `x_{${index + 1}}`
    ).join(" + ");
    for (let index = 1; index <= 12; index += 1) {
      await editor.fill(
        `\\begin{equation}\\label{eq:stable}${wideEquation}=${index}\\end{equation}`
      );
    }
    await expect.poll(() => page.evaluate(() => {
      const testWindow = window as Window & {
        __mathJaxTypesetStats?: { active: number; calls: number };
      };
      const stats = testWindow.__mathJaxTypesetStats;
      return Boolean(stats && stats.calls > 0 && stats.active === 0);
    })).toBe(true);
    await expect
      .poll(() => page.locator('[role="tabpanel"] mjx-container').count())
      .toBe(1);
    const finalStats = await page.evaluate(() => {
      const testWindow = window as Window & {
        __mathJaxTypesetStats?: {
          maxActive: number;
          calls: number;
          clears: number;
        };
      };
      return testWindow.__mathJaxTypesetStats;
    });
    expect(finalStats?.maxActive).toBe(1);
    expect(finalStats?.clears).toBeGreaterThan(0);

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
    const heatmapPreview = page.locator(
      '[aria-label="题目预览"] [data-latex-preview]'
    );
    await expect
      .poll(() => heatmapPreview.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      ))
      .toBeGreaterThan(0);
    await expect
      .poll(() => heatmapPreview.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaX: 120
        }));
        return element.scrollLeft;
      }))
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
    const editor = page.locator(".cm-content[contenteditable='true']");
    await editor.click();
    const typedAt = Date.now();
    await editor.pressSequentially("x".repeat(50));
    expect(Date.now() - typedAt).toBeLessThan(5000);
    await expect(editor).toContainText("x".repeat(50));

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

    await page.locator('[data-heatmap-cell="large-10-100"]').focus();
    await expect(page.getByRole("heading", { name: "10-100" })).toBeVisible();
    await expect
      .poll(() => page.locator('[aria-label="题目预览"] mjx-container').count())
      .toBeGreaterThan(0);
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
  }
});
