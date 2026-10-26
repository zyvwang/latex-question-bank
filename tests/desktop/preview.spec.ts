import { _electron as electron, expect, test } from "@playwright/test";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createSampleBank } from "../../server/bank-schema.js";

test("keeps MathJax previews working in the editor", async () => {
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
    await expect(page.getByLabel("来源题号")).toHaveValue("示例 1");
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

    await page.getByText("示例题库 示例 2", { exact: true }).click();
    await expect(page.getByLabel("来源题号")).toHaveValue("示例 2");
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
