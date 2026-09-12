import { closeDesktopApp } from "../fixtures/desktop-app.js";
import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";

test("virtual sidebar preserves selection, focus, sticky handoff and drag after scrolling", async () => {
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(path.resolve(".tmp/virtual-sidebar-"));
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace);
  const bank = createSampleBank();
  bank.chapters = [{ id: "a", name: "第一章", order: 1 }, { id: "b", name: "第二章：含参数的分段函数连续性与极限的分类讨论", order: 2 }];
  bank.items = Array.from({ length: 1200 }, (_, i) => ({
    ...bank.items[0], id: `virtual-${i}`, chapterId: i < 600 ? "a" : "b",
    chapterOrder: i % 600 + 1, sourceNumber: `V${i}`, assets: [],
    tags: i % 10 === 0 ? ["目标", "这是需要完整换行显示的长方法标签"] : ["普通"]
  }));
  await writeFile(path.join(workspace, "bank.json"), JSON.stringify(bank));
  const app = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_WORKSPACE_DIR: workspace, LQB_APP_DATA_DIR: path.join(directory, "app-data")
  } });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1470, height: 891 });
    const list = page.getByLabel("题目列表", { exact: true });
    await expect(list).toHaveAttribute("data-question-count", "1200");
    await expect(page.locator("#question-nav-virtual-0")).toBeVisible();
    expect(await list.locator("[data-question-id]").count()).toBeLessThan(80);
    // Tab traverses controls beyond the original mounted window without skipping rows.
    await page.locator("#question-nav-virtual-0").focus();
    for (let i = 1; i <= 18; i++) {
      await page.keyboard.press("Tab");
      await expect(list.getByRole("checkbox", { name: `选择导出 V${i}`, exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator(`#question-nav-virtual-${i}`)).toBeFocused();
    }
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#question-nav-virtual-17")).toBeFocused();
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator("#question-nav-virtual-1199")).toBeVisible();
    await expect(page.locator("#question-nav-virtual-17")).toBeFocused();
    await page.getByRole("separator", { name: "调整题目侧栏宽度" }).press("Home");
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const last = page.locator("#question-nav-virtual-1199");
    await expect(last).toBeVisible();
    await last.focus();
    const heading = list.getByRole("heading").nth(1);
    expect((await last.boundingBox())!.y).toBeGreaterThanOrEqual((await heading.boundingBox())!.y + (await heading.boundingBox())!.height);
    const source = list.locator('[data-question-id="virtual-1198"]').getByTitle("拖拽排序");
    const from = (await source.boundingBox())!;
    const to = (await last.boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(to.x + 20, to.y + to.height - 3);
    await page.mouse.up();
    await expect(page.locator("#main-workspace").getByLabel("原编号", { exact: true })).toHaveValue("V1198");
    await list.getByRole("checkbox", { name: "选择导出 V1198", exact: true }).uncheck();
    const search = page.getByRole("textbox", { name: "搜索题目" });
    await search.fill("目标");
    await expect(list).toHaveAttribute("data-question-count", "120");
    await search.fill("");
    await expect(list).toHaveAttribute("data-question-count", "1200");
    await page.getByRole("button", { name: "切换到已选中列表" }).click();
    await expect(list).toHaveAttribute("data-question-count", "1199");
    expect(await list.locator("[data-question-id]").count()).toBeLessThan(80);
    await page.getByRole("button", { name: "返回当前列表" }).click();
    await page.setViewportSize({ width: 760, height: 891 });
    await expect(list.locator("[data-question-id]")).toHaveCount(1200);
    await page.setViewportSize({ width: 1470, height: 891 });
    await expect.poll(() => list.locator("[data-question-id]").count()).toBeLessThan(80);
  } finally {
    await closeDesktopApp(app);
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
