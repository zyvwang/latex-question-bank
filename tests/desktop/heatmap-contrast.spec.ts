import { closeDesktopApp } from "../fixtures/desktop-app.js";
import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSampleBank } from "../../server/bank-schema.js";
import { contrastRatio } from "../../src/color-contrast.js";

test("numbers remain legible over mixed black and white error stripes", async () => {
  await mkdir(".tmp", { recursive: true });
  const directory = await mkdtemp(path.resolve(".tmp/heatmap-contrast-"));
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace);
  const bank = createSampleBank();
  bank.errorReasonOptions = ["#000000", "#FFFFFF", "#000000", "#FFFFFF"].map((color, i) => ({
    id: `contrast-${i}`, name: `错误 ${i}`, color, order: i + 1, pattern: "solid" as const
  }));
  bank.items = [1, 2, 3, 4].map((count) => ({
    ...bank.items[0], id: `contrast-${count}`, sourceNumber: `C${count}`, chapterOrder: count,
    errorReasonOptionIds: bank.errorReasonOptions.slice(0, count).map((option) => option.id)
  }));
  await writeFile(path.join(workspace, "bank.json"), JSON.stringify(bank));
  const app = await electron.launch({ args: ["."], env: {
    ...process.env, LQB_WORKSPACE_DIR: workspace, LQB_APP_DATA_DIR: path.join(directory, "app-data")
  } });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "热力图", exact: true }).click();
    await page.getByRole("button", { name: "错误原因", exact: true }).click();
    for (const count of [2, 3, 4]) {
      const cell = page.locator(`#heatmap-cell-contrast-${count}`);
      const colors = await cell.locator("strong").evaluate((el) => {
        const style = getComputedStyle(el);
        // Canvas resolves CSS Color 4 tokens to sRGB for contrast calculation.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const toHex = (value: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          const bytes = context.getImageData(0, 0, 1, 1).data;
          return { hex: `#${[...bytes].slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("")}`, alpha: bytes[3] };
        };
        return { foreground: toHex(style.color), background: toHex(style.backgroundColor) };
      });
      expect(colors.background.alpha).toBe(255);
      expect(contrastRatio(colors.foreground.hex, colors.background.hex)).toBeGreaterThanOrEqual(4.5);
      await expect(cell.locator("[data-error-stripes]")).toHaveAttribute("data-error-stripes", String(Math.min(3, count)));
    }
    await expect(page.locator("#heatmap-cell-contrast-4 small")).toHaveText("+1");
    await expect(page.locator("#heatmap-cell-contrast-1 strong")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  } finally {
    await closeDesktopApp(app);
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
